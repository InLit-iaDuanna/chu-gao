import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  generationRequestSchema,
  validateAgainstModel,
} from "@/lib/models/validate";
import { enqueueGeneration } from "@/lib/queue";

export interface RecoverStuckGenerationsOptions {
  stuckPendingMs: number;
  stuckRunningMs: number;
  stuckMaxAttempts: number;
}

async function refundGeneration(
  generationId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const refunded = await tx.usageLog.aggregate({
      where: {
        generationId,
        action: "refund",
      },
      _sum: {
        creditsDelta: true,
      },
    });
    const charged = await tx.usageLog.aggregate({
      where: {
        generationId,
        action: "generate",
      },
      _sum: {
        creditsDelta: true,
      },
    });
    const debitedCredits = Math.max(0, -(charged._sum.creditsDelta ?? 0));
    const refundedCredits = Math.max(0, refunded._sum.creditsDelta ?? 0);
    const refundableCredits = Math.max(0, debitedCredits - refundedCredits);

    if (refundableCredits === 0) {
      return;
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        credits: {
          increment: refundableCredits,
        },
      },
    });

    await tx.usageLog.create({
      data: {
        userId,
        generationId,
        action: "refund",
        creditsDelta: refundableCredits,
        metadata: {
          reason,
        },
      },
    });
  });
}

async function markGenerationFailedAndRefund(
  generationId: string,
  userId: string,
  errorCode: string,
  errorMessage: string,
  reason: string,
): Promise<void> {
  const failed = await db.generation.updateMany({
    where: {
      id: generationId,
      userId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorCode,
      errorMessage,
    },
  });

  if (failed.count > 0) {
    await refundGeneration(generationId, userId, reason);
  }
}

export async function recoverStuckGenerations({
  stuckPendingMs,
  stuckRunningMs,
  stuckMaxAttempts,
}: RecoverStuckGenerationsOptions): Promise<void> {
  const now = Date.now();
  const stuck = await db.generation.findMany({
    where: {
      deletedAt: null,
      status: { in: ["PENDING", "RUNNING"] },
      OR: [
        {
          status: "PENDING",
          createdAt: { lt: new Date(now - stuckPendingMs) },
        },
        {
          status: "RUNNING",
          OR: [
            { heartbeatAt: { lt: new Date(now - stuckRunningMs) } },
            {
              heartbeatAt: null,
              startedAt: { lt: new Date(now - stuckRunningMs) },
            },
          ],
        },
      ],
    },
    take: 100,
    select: {
      id: true,
      userId: true,
      status: true,
      attempts: true,
      modelId: true,
      prompt: true,
      negativePrompt: true,
      aspectRatio: true,
      resolution: true,
      n: true,
      outputFormat: true,
      paramsRaw: true,
      referenceImageKeys: true,
      costCredits: true,
      jobId: true,
      executionToken: true,
      heartbeatAt: true,
      startedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  for (const generation of stuck) {
    const recoveryClaim = await db.generation.updateMany({
      where: {
        id: generation.id,
        userId: generation.userId,
        status: generation.status,
        executionToken: generation.executionToken,
        ...(generation.status === "RUNNING"
          ? {
              heartbeatAt: generation.heartbeatAt,
              startedAt: generation.startedAt,
            }
          : { createdAt: generation.createdAt }),
      },
      data: {
        status: "PENDING",
        progress: 0,
        executionToken: null,
        heartbeatAt: null,
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });

    if (recoveryClaim.count === 0) {
      logger.info(
        { generationId: generation.id },
        "Stuck generation recovery skipped because execution changed.",
      );
      continue;
    }

    if (generation.attempts >= stuckMaxAttempts) {
      await markGenerationFailedAndRefund(
        generation.id,
        generation.userId,
        "STUCK_JOB",
        "任务长时间未完成，已自动终止并退还点数。",
        "stuck_generation",
      );
      logger.warn(
        { generationId: generation.id, attempts: generation.attempts },
        "Stuck generation failed after max recovery attempts.",
      );
      continue;
    }

    const parsedRequest = generationRequestSchema.safeParse(
      generation.paramsRaw,
    );

    if (!parsedRequest.success) {
      await markGenerationFailedAndRefund(
        generation.id,
        generation.userId,
        "STUCK_JOB_INVALID_REQUEST",
        "历史任务参数已不可恢复，已自动终止并退还点数。",
        "stuck_generation_invalid_request",
      );
      logger.warn(
        { generationId: generation.id },
        "Stuck generation failed because paramsRaw is invalid.",
      );
      continue;
    }

    const request = await validateAgainstModel(parsedRequest.data);

    const jobId = await enqueueGeneration(
      {
        generationId: generation.id,
        userId: generation.userId,
        request,
        estimatedCredits: generation.costCredits,
      },
      {
        jobId: `${generation.id}-recovery-${generation.attempts + 1}`,
      },
    );

    if (jobId !== generation.jobId) {
      await db.generation.update({
        where: { id: generation.id },
        data: { jobId },
      });
    }

    logger.info(
      { generationId: generation.id, previousStatus: generation.status },
      "Recovered stuck generation into queue.",
    );
  }
}
