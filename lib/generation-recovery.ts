import type { GenerationStatus, PrismaClient } from "@prisma/client";

type RecoveryClient = Pick<PrismaClient, "$transaction">;

export interface RecoverableGenerationSnapshot {
  id: string;
  userId: string;
  status: Extract<GenerationStatus, "PENDING" | "RUNNING">;
  executionToken: string | null;
  heartbeatAt: Date | null;
  startedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export type GenerationRecoveryOutcome =
  | { kind: "requeue" }
  | { kind: "cancel"; refundReason: string }
  | {
      kind: "fail";
      errorCode: string;
      errorMessage: string;
      refundReason: string;
    };

export async function claimGenerationForRecovery(
  client: RecoveryClient,
  generation: RecoverableGenerationSnapshot,
  recoveredAt = new Date(),
  options: { outcome?: GenerationRecoveryOutcome } = {},
): Promise<{ claimed: boolean; releasedLeases: number }> {
  return client.$transaction(async (tx) => {
    const activeLeases = generation.executionToken
      ? await tx.providerAccountLease.findMany({
          where: {
            generationId: generation.id,
            executionToken: generation.executionToken,
            releasedAt: null,
          },
          select: {
            id: true,
            providerAccountId: true,
          },
        })
      : [];

    // Account acquisition and normal release both lock ProviderAccount first.
    // Follow the same order here to avoid a worker/recovery deadlock. Sorting
    // also keeps the order deterministic if legacy data contains >1 lease.
    const accountIds = [
      ...new Set(activeLeases.map((lease) => lease.providerAccountId)),
    ].sort();
    const lockedAccountIds = new Set<string>();
    for (const accountId of accountIds) {
      const accountRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "ProviderAccount"
        WHERE "id" = ${accountId}
        FOR UPDATE
      `;
      if (accountRows.length > 0) {
        lockedAccountIds.add(accountId);
      }
    }

    // Claim before marking any lease released. A late heartbeat using the old
    // token can no longer succeed after this update.
    const outcome: GenerationRecoveryOutcome = options.outcome ?? {
      kind: "requeue",
    };
    const nextStatus =
      outcome.kind === "requeue"
        ? "PENDING"
        : outcome.kind === "cancel"
          ? "CANCELED"
          : "FAILED";
    const claimed = await tx.generation.updateMany({
      where: {
        id: generation.id,
        userId: generation.userId,
        status: generation.status,
        executionToken: generation.executionToken,
        deletedAt: generation.deletedAt,
        ...(generation.status === "RUNNING"
          ? {
              heartbeatAt: generation.heartbeatAt,
              startedAt: generation.startedAt,
            }
          : {
              createdAt: generation.createdAt,
              heartbeatAt: generation.heartbeatAt,
            }),
      },
      data: {
        status: nextStatus,
        progress: 0,
        executionToken: null,
        heartbeatAt: recoveredAt,
        startedAt: null,
        finishedAt: outcome.kind === "requeue" ? null : recoveredAt,
        errorCode: outcome.kind === "fail" ? outcome.errorCode : null,
        errorMessage: outcome.kind === "fail" ? outcome.errorMessage : null,
      },
    });

    if (claimed.count === 0) {
      return { claimed: false, releasedLeases: 0 };
    }

    let releasedLeases = 0;
    for (const lease of activeLeases) {
      const released = await tx.providerAccountLease.updateMany({
        where: { id: lease.id, releasedAt: null },
        data: {
          releasedAt: recoveredAt,
          releaseReason: "stuck_recovery",
        },
      });
      if (released.count === 0) {
        continue;
      }

      releasedLeases += 1;
      if (!lockedAccountIds.has(lease.providerAccountId)) {
        continue;
      }
      const activeLeaseCount = await tx.providerAccountLease.count({
        where: {
          providerAccountId: lease.providerAccountId,
          releasedAt: null,
        },
      });
      await tx.providerAccount.update({
        where: { id: lease.providerAccountId },
        data: { inFlight: activeLeaseCount },
      });
    }

    const refundReason =
      outcome.kind === "fail" || outcome.kind === "cancel"
        ? outcome.refundReason
        : null;
    if (refundReason) {
      const refunded = await tx.usageLog.aggregate({
        where: {
          generationId: generation.id,
          action: "refund",
        },
        _sum: {
          creditsDelta: true,
        },
      });
      const charged = await tx.usageLog.aggregate({
        where: {
          generationId: generation.id,
          action: "generate",
        },
        _sum: {
          creditsDelta: true,
        },
      });
      const debitedCredits = Math.max(0, -(charged._sum.creditsDelta ?? 0));
      const refundedCredits = Math.max(0, refunded._sum.creditsDelta ?? 0);
      const refundableCredits = Math.max(0, debitedCredits - refundedCredits);

      if (refundableCredits > 0) {
        await tx.user.update({
          where: { id: generation.userId },
          data: {
            credits: {
              increment: refundableCredits,
            },
          },
        });

        await tx.usageLog.create({
          data: {
            userId: generation.userId,
            generationId: generation.id,
            action: "refund",
            creditsDelta: refundableCredits,
            metadata: {
              reason: refundReason,
            },
          },
        });
      }
    }

    return { claimed: true, releasedLeases };
  });
}
