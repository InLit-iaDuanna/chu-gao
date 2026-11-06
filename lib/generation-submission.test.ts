import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  current: vi.fn(),
  enqueue: vi.fn(),
  assertAllowed: vi.fn(),
  assertIdle: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    generation: { findUniqueOrThrow: mocks.current },
  },
}));
vi.mock("@/lib/queue", () => ({ enqueueGeneration: mocks.enqueue }));
vi.mock("@/lib/rate-limit", () => ({
  assertGenerationAllowedForClient: mocks.assertAllowed,
}));
vi.mock("@/lib/chat-turns", () => ({
  assertChatConversationIdle: mocks.assertIdle,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/storage", () => ({
  privateImageUrl: vi.fn(),
  privateImageThumbnailUrl: vi.fn(),
}));

import {
  createAndEnqueueGeneration,
  GenerationQueueError,
  InsufficientCreditsError,
  type CreateGenerationInput,
} from "@/lib/generations";

const input: CreateGenerationInput = {
  userId: "user-1",
  request: {
    modelId: "gpt-image-2",
    protocol: "openai-images",
    prompt: "A street",
    size: "1024x1024",
    quality: "auto",
    responseFormat: "b64_json",
    aspectRatio: "1:1",
    resolution: "1K",
    n: 1,
    outputFormat: "png",
    background: "auto",
  },
  normalizedRequestParams: { modelId: "gpt-image-2", prompt: "A street", n: 1 },
  estimatedCredits: 10,
  pricingSnapshotJson: { perImageCredits: 10 },
};

function makeTransaction() {
  return {
    $executeRaw: vi.fn(),
    generation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockResolvedValue({ id: "generation-1", status: "PENDING" }),
      update: vi.fn().mockResolvedValue({ id: "generation-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
    },
    usageLog: {
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    agentAuthorization: {
      findFirst: vi.fn().mockResolvedValue({id: "grant-1", mode: "single", boundGenerationId: null, revokedAt: null, expiresAt: new Date(Date.now() + 3600_000), sessionVersion: 1, user: {status: "ACTIVE", sessionVersion: 1}}),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({count: 1}),
    },
  };
}

let tx: ReturnType<typeof makeTransaction>;
beforeEach(() => {
  vi.resetAllMocks();
  tx = makeTransaction();
  tx.usageLog.aggregate.mockImplementation(async ({ where }) => ({
    _sum: { creditsDelta: where.action === "generate" ? -10 : 0 },
  }));
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  mocks.enqueue.mockResolvedValue("generation-1");
});

describe("generation submission and queue compensation", () => {
  it("binds a single-task Agent grant in the transaction that creates and charges the job", async () => {
    await createAndEnqueueGeneration({...input, agentAuthorizationId: "grant-1"});
    expect(tx.agentAuthorization.updateMany).toHaveBeenCalledWith({where: {id: "grant-1", mode: "single", boundGenerationId: null}, data: {boundGenerationId: "generation-1"}});
    expect(tx.generation.create.mock.calls[0][0].data.agentAuthorizationId).toBe("grant-1");
    expect(tx.usageLog.create.mock.calls[0][0].data.metadata.source).toBe("agent");
  });
  it("rejects a second task on the same single-task grant before charging", async () => {
    tx.agentAuthorization.findFirst.mockResolvedValue({mode: "single", boundGenerationId: "existing-job", revokedAt: null, expiresAt: new Date(Date.now() + 3600_000), sessionVersion: 1, user: {status: "ACTIVE", sessionVersion: 1}});
    await expect(createAndEnqueueGeneration({...input, agentAuthorizationId: "grant-1"})).rejects.toThrow("已用于一个任务");
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects history mutations in an active chat before creating or charging an image job", async () => {
    mocks.assertIdle.mockRejectedValueOnce(new Error("CHAT_TURN_BUSY"));
    await expect(
      createAndEnqueueGeneration({
        ...input,
        conversationId: "active-chat",
        userMessage: "new image prompt",
      }),
    ).rejects.toThrow("CHAT_TURN_BUSY");
    expect(tx.generation.create).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("commits a deterministic job ID and charge before dispatch, with no post-dispatch write", async () => {
    mocks.enqueue.mockImplementation(async () => {
      expect(tx.generation.update).toHaveBeenCalledWith({
        where: { id: "generation-1" },
        data: { jobId: "generation-1" },
      });
      expect(tx.usageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "generate",
          creditsDelta: -10,
        }),
      });
      return "generation-1";
    });

    expect(await createAndEnqueueGeneration(input)).toEqual({
      generationId: "generation-1",
      status: "PENDING",
      jobId: "generation-1",
      estimatedCredits: 10,
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      {
        generationId: "generation-1",
        userId: input.userId,
        request: input.request,
        estimatedCredits: 10,
      },
      { jobId: "generation-1" },
    );
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(tx.generation.update).toHaveBeenCalledOnce();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("does not dispatch when writing the job ID fails inside the creation transaction", async () => {
    tx.generation.update.mockRejectedValue(new Error("database unavailable"));

    await expect(createAndEnqueueGeneration(input)).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.usageLog.create).not.toHaveBeenCalled();
  });

  it("does not dispatch when the atomic debit fails", async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(createAndEnqueueGeneration(input)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("claims an untouched pending job and refunds its ledger in the same transaction", async () => {
    mocks.enqueue.mockRejectedValue(new Error("queue unavailable"));

    await expect(createAndEnqueueGeneration(input)).rejects.toBeInstanceOf(
      GenerationQueueError,
    );
    expect(tx.generation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "generation-1",
        userId: "user-1",
        status: "PENDING",
        executionToken: null,
        attempts: 0,
        heartbeatAt: null,
        jobId: "generation-1",
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorCode: "QUEUE_ERROR",
        finishedAt: expect.any(Date),
      }),
    });
    expect(tx.generation.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.usageLog.aggregate.mock.invocationCallOrder[0],
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { credits: { increment: 10 } },
    });
    expect(tx.usageLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        generationId: "generation-1",
        action: "refund",
        creditsDelta: 10,
      }),
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("refunds only the remaining debit, not the quoted estimate", async () => {
    mocks.enqueue.mockRejectedValue(new Error("queue unavailable"));
    tx.usageLog.aggregate.mockImplementation(async ({ where }) => ({
      _sum: { creditsDelta: where.action === "generate" ? -8 : 3 },
    }));

    await expect(createAndEnqueueGeneration(input)).rejects.toBeInstanceOf(
      GenerationQueueError,
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { credits: { increment: 5 } },
    });
  });

  it.each([0, 10, 15])(
    "does not create a refund when no refundable debit remains (%s)",
    async (refunded) => {
      mocks.enqueue.mockRejectedValue(new Error("queue unavailable"));
      tx.usageLog.aggregate.mockImplementation(async ({ where }) => ({
        _sum: {
          creditsDelta:
            where.action === "generate" ? (refunded ? -10 : null) : refunded,
        },
      }));

      await expect(createAndEnqueueGeneration(input)).rejects.toBeInstanceOf(
        GenerationQueueError,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.usageLog.create).toHaveBeenCalledOnce();
    },
  );

  it.each(["RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "PENDING"])(
    "returns the existing %s task without refunding if another execution, cancellation or recovery won",
    async (status) => {
      mocks.enqueue.mockRejectedValue(new Error("queue acknowledgement lost"));
      tx.generation.updateMany.mockResolvedValue({ count: 0 });
      mocks.current.mockResolvedValue({ status, jobId: "current-job" });

      expect(await createAndEnqueueGeneration(input)).toEqual({
        generationId: "generation-1",
        status,
        jobId: "current-job",
        estimatedCredits: 10,
      });
      expect(tx.usageLog.aggregate).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.usageLog.create).toHaveBeenCalledOnce();
      expect(mocks.enqueue).toHaveBeenCalledOnce();
    },
  );
});

describe("creative submission idempotency", () => {
  const operation = { id: "operation-1", requestHash: "same-hash" };
  it("persists the operation in the same transaction as the charge", async () => {
    await createAndEnqueueGeneration({ ...input, operation });
    expect(tx.generation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paramsRaw: expect.objectContaining({ _submission: operation }),
        }),
      }),
    );
  });
  it("returns the existing task before balance or capacity checks and never dispatches twice", async () => {
    tx.generation.findFirst.mockResolvedValue({
      id: "original",
      status: "RUNNING",
      jobId: "original",
      costCredits: 10,
      pricingSnapshot: { estimatedCredits: 10 },
      paramsRaw: { _submission: operation },
    } as never);
    expect(
      await createAndEnqueueGeneration({ ...input, operation }),
    ).toMatchObject({
      generationId: "original",
      status: "RUNNING",
      estimatedCredits: 10,
    });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.assertAllowed).not.toHaveBeenCalled();
    expect(tx.generation.create).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects reusing an operation ID with different content", async () => {
    tx.generation.findFirst.mockResolvedValue({
      paramsRaw: { _submission: { ...operation, requestHash: "different" } },
    } as never);
    await expect(
      createAndEnqueueGeneration({ ...input, operation }),
    ).rejects.toThrow("另一份方案");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
