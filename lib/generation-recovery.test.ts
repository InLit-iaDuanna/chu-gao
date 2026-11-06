import { describe, expect, it, vi } from "vitest";

import { claimGenerationForRecovery } from "@/lib/generation-recovery";

const snapshot = {
  id: "generation-1",
  userId: "user-1",
  status: "RUNNING" as const,
  executionToken: "execution-1",
  heartbeatAt: new Date("2026-08-04T07:00:00.000Z"),
  startedAt: new Date("2026-08-04T06:50:00.000Z"),
  createdAt: new Date("2026-08-04T06:49:00.000Z"),
  deletedAt: null,
};

describe("stuck generation lease recovery", () => {
  it("claims the stale execution before releasing its provider lease", async () => {
    const calls: string[] = [];
    const tx = {
      generation: {
        updateMany: vi.fn(async () => {
          calls.push("claim-generation");
          return { count: 1 };
        }),
      },
      providerAccountLease: {
        findMany: vi.fn(async () => {
          calls.push("find-lease");
          return [{ id: "lease-1", providerAccountId: "account-1" }];
        }),
        updateMany: vi.fn(async () => {
          calls.push("release-lease");
          return { count: 1 };
        }),
        count: vi.fn(async () => {
          calls.push("count-active-leases");
          return 0;
        }),
      },
      providerAccount: {
        update: vi.fn(async () => {
          calls.push("sync-account");
          return { id: "account-1" };
        }),
      },
      $queryRaw: vi.fn(async () => {
        calls.push("lock-account");
        return [{ id: "account-1" }];
      }),
    };
    const client = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const recoveredAt = new Date("2026-08-04T08:00:00.000Z");

    const result = await claimGenerationForRecovery(
      client as never,
      snapshot,
      recoveredAt,
    );

    expect(result).toEqual({ claimed: true, releasedLeases: 1 });
    expect(calls).toEqual([
      "find-lease",
      "lock-account",
      "claim-generation",
      "release-lease",
      "count-active-leases",
      "sync-account",
    ]);
    expect(tx.providerAccountLease.updateMany).toHaveBeenCalledWith({
      where: { id: "lease-1", releasedAt: null },
      data: {
        releasedAt: recoveredAt,
        releaseReason: "stuck_recovery",
      },
    });
  });

  it("does not release a lease when a late heartbeat wins the claim race", async () => {
    const tx = {
      generation: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      providerAccountLease: {
        findMany: vi.fn(async () => [
          { id: "lease-1", providerAccountId: "account-1" },
        ]),
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      providerAccount: { update: vi.fn() },
      $queryRaw: vi.fn(async () => [{ id: "account-1" }]),
    };
    const client = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const result = await claimGenerationForRecovery(client as never, snapshot);

    expect(result).toEqual({ claimed: false, releasedLeases: 0 });
    expect(tx.providerAccountLease.findMany).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.providerAccountLease.updateMany).not.toHaveBeenCalled();
    expect(tx.providerAccount.update).not.toHaveBeenCalled();
  });

  it("cancels and refunds a stale soft-deleted execution", async () => {
    const recoveredAt = new Date("2026-08-04T08:00:00.000Z");
    const tx = {
      generation: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      providerAccountLease: {
        findMany: vi.fn(async () => [
          { id: "lease-1", providerAccountId: "account-1" },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        count: vi.fn(async () => 0),
      },
      providerAccount: {
        update: vi.fn(async () => ({ id: "account-1" })),
      },
      usageLog: {
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { creditsDelta: 0 } })
          .mockResolvedValueOnce({ _sum: { creditsDelta: -10 } }),
        create: vi.fn(async () => ({ id: "refund-1" })),
      },
      user: {
        update: vi.fn(async () => ({ id: "user-1" })),
      },
      $queryRaw: vi.fn(async () => [{ id: "account-1" }]),
    };
    const client = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const result = await claimGenerationForRecovery(
      client as never,
      snapshot,
      recoveredAt,
      {
        outcome: {
          kind: "cancel",
          refundReason: "soft_deleted_generation",
        },
      },
    );

    expect(result).toEqual({ claimed: true, releasedLeases: 1 });
    expect(tx.generation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELED",
          finishedAt: recoveredAt,
          executionToken: null,
        }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { credits: { increment: 10 } },
    });
    expect(tx.usageLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        generationId: "generation-1",
        action: "refund",
        creditsDelta: 10,
        metadata: { reason: "soft_deleted_generation" },
      },
    });
  });

  it("fails, releases, and refunds a terminal recovery in one transaction", async () => {
    const recoveredAt = new Date("2026-08-04T08:00:00.000Z");
    const tx = {
      generation: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      providerAccountLease: {
        findMany: vi.fn(async () => [
          { id: "lease-1", providerAccountId: "account-1" },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        count: vi.fn(async () => 0),
      },
      providerAccount: {
        update: vi.fn(async () => ({ id: "account-1" })),
      },
      usageLog: {
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { creditsDelta: 2 } })
          .mockResolvedValueOnce({ _sum: { creditsDelta: -10 } }),
        create: vi.fn(async () => ({ id: "refund-1" })),
      },
      user: {
        update: vi.fn(async () => ({ id: "user-1" })),
      },
      $queryRaw: vi.fn(async () => [{ id: "account-1" }]),
    };
    const client = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const result = await claimGenerationForRecovery(
      client as never,
      snapshot,
      recoveredAt,
      {
        outcome: {
          kind: "fail",
          errorCode: "STUCK_JOB",
          errorMessage: "stuck",
          refundReason: "stuck_generation",
        },
      },
    );

    expect(result).toEqual({ claimed: true, releasedLeases: 1 });
    expect(tx.generation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
        data: expect.objectContaining({
          status: "FAILED",
          errorCode: "STUCK_JOB",
          errorMessage: "stuck",
          finishedAt: recoveredAt,
        }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { credits: { increment: 8 } },
    });
    expect(tx.usageLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        generationId: "generation-1",
        action: "refund",
        creditsDelta: 8,
        metadata: { reason: "stuck_generation" },
      },
    });
  });
});
