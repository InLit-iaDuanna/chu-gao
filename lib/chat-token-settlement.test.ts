// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { OPUS_MODEL_ID } from "./chat-model-options";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  debit: vi.fn(),
  refund: vi.fn(),
  profile: vi.fn(),
  context: vi.fn(),
  receipt: vi.fn(),
  raw: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    $queryRaw: mocks.raw,
    chatRequestReceipt: { findUnique: mocks.receipt },
  },
}));
vi.mock("@/lib/chat-billing", () => ({
  debitChatCredits: mocks.debit,
  refundChatCredits: mocks.refund,
}));
vi.mock("@/lib/chat-profiles", () => ({ getChatProfile: mocks.profile }));
vi.mock("@/lib/chat-context", () => ({ prepareChatContext: mocks.context }));
vi.mock("@/lib/chat-runtime-config", () => ({
  CHAT_TASK_PROTOCOL_VERSION: 2,
  assertChatRuntimeAdmission: async () => ({ queueTimeoutMs: null }),
}));
vi.mock("@/lib/ai-config", () => ({
  getConversationSystemPrompt: async () => "instructions",
}));
vi.mock("@/lib/chat-references", () => ({
  resolveChatReferences: async () => [],
}));

import {
  chatTurnSchema,
  createChatTurn,
  finishChatAttempt,
} from "./chat-turns";
import { closeChatReserve } from "./chat-credit-ledger";
import {
  chatInputTokenUpperBound,
  chatTokenReserve,
} from "./chat-token-billing";
import {
  auditChatLedger,
  type ChatLedgerAuditInput,
} from "./chat-ledger-audit";

const pricing = {
  type: "per_million_tokens" as const,
  input: 100,
  output: 500,
  cacheRead: 5,
  cacheCreation: 60,
};
const usage = {
  prompt_tokens: 270,
  completion_tokens: 1,
  input_tokens: 270,
  output_tokens: 0,
  prompt_tokens_details: {
    cached_tokens: 35,
    cached_creation_tokens: 227,
    cache_write_tokens: 227,
  },
  claude_cache_creation_5_m_tokens: 227,
  claude_cache_creation_1_h_tokens: 0,
};

describe("actual-token settlement transactions", () => {
  const snapshot = {
    version: 1 as const,
    pricing,
    maxInputTokens: 1000,
    maxOutputTokens: 1000,
  };
  let turn: Record<string, unknown>;
  let attempt: Record<string, unknown>;
  let entries: Array<Record<string, unknown>>;
  let balance: number;
  const tx = {
    $queryRaw: vi.fn(),
    chatTurn: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    chatAttempt: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    creditEntry: { findUnique: vi.fn(), create: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
    usageLog: { create: vi.fn() },
    conversationMessage: { updateMany: vi.fn(), createMany: vi.fn() },
    chatEvent: { create: vi.fn() },
    conversation: { findFirst: vi.fn(), update: vi.fn() },
    chatRequestReceipt: { findUnique: vi.fn(), create: vi.fn() },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    balance = 9.4;
    turn = {
      id: "turn",
      userId: "user",
      conversationId: "conversation",
      modelId: OPUS_MODEL_ID,
      activeAttemptId: "attempt",
      chargedCredits: 0,
      nextSeq: 0,
      configSnapshot: {
        model: OPUS_MODEL_ID,
        tokenPricing: structuredClone(snapshot),
      },
    };
    attempt = {
      id: "attempt",
      turnId: "turn",
      status: "running",
      executionToken: "worker",
      billingState: "reserved",
      heldCredits: 0.6,
      rawText: "answer",
      usage: null,
    };
    entries = [];
    mocks.transaction.mockImplementation(async (run) => run(tx));
    tx.$queryRaw.mockResolvedValue([{ now: new Date() }]);
    mocks.raw.mockResolvedValue([{ now: new Date() }]);
    mocks.receipt.mockResolvedValue(null);
    tx.chatRequestReceipt.findUnique.mockResolvedValue(null);
    tx.chatTurn.findUnique.mockImplementation(async ({ where }) =>
      where.activeConversationId ? null : { ...turn },
    );
    tx.chatAttempt.findUnique.mockImplementation(async () => ({ ...attempt }));
    tx.chatTurn.update.mockImplementation(async ({ data }) => {
      const { nextSeq, ...rest } = data;
      Object.assign(turn, rest);
      if (nextSeq) turn.nextSeq = Number(turn.nextSeq) + 1;
      return turn;
    });
    tx.chatAttempt.update.mockImplementation(async ({ data }) =>
      Object.assign(attempt, data),
    );
    tx.creditEntry.findUnique.mockImplementation(
      async ({ where }) =>
        entries.find((entry) => entry.operationKey === where.operationKey) ??
        null,
    );
    tx.creditEntry.create.mockImplementation(async ({ data }) => {
      entries.push(data);
      return data;
    });
    tx.user.findUniqueOrThrow.mockImplementation(async () => ({
      credits: balance,
      concurrentLimit: 2,
    }));
    mocks.refund.mockImplementation(async (_tx, _id, amount) => {
      balance = Number((balance + amount).toFixed(6));
      return { credits: balance };
    });
    tx.conversation.findFirst.mockResolvedValue({
      id: "conversation",
      contextRevision: 0,
    });
    tx.chatTurn.count.mockResolvedValue(0);
    tx.chatTurn.create.mockImplementation(async ({ data }) =>
      Object.assign(turn, data),
    );
    tx.chatAttempt.create.mockImplementation(async ({ data }) =>
      Object.assign(attempt, data, {
        status: "queued",
        rawText: "",
        createdAt: new Date(),
        startedAt: null,
        sources: null,
        ordinal: 1,
      }),
    );
    tx.chatTurn.findFirst.mockImplementation(async () => ({
      ...turn,
      attempts: [{ ...attempt }],
    }));
    mocks.debit.mockImplementation(async (_tx, _id, amount) => {
      balance -= amount;
      return { count: 1 };
    });
    mocks.profile.mockResolvedValue({
      enabled: true,
      apiKey: "fixture-key",
      model: OPUS_MODEL_ID,
      baseUrl: "https://fixture.invalid",
      credits: 0,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      vision: true,
      webSearch: false,
      transport: "chat_completions_sse",
      tokenPricing: {
        ...structuredClone(snapshot),
        maxInputTokens: 262_144,
        maxOutputTokens: 16_384,
      },
    });
    mocks.context.mockImplementation(async ({ latestMessage }) => ({
      messages: [latestMessage],
      manifest: { revision: 0 },
    }));
  });

  const finish = (extra = {}) =>
    finishChatAttempt({
      turnId: "turn",
      attemptId: "attempt",
      executionToken: "worker",
      status: "completed",
      usage,
      ...extra,
    });

  const create = () =>
    createChatTurn(
      "user",
      chatTurnSchema.parse({
        conversationId: "conversation",
        clientRequestId: "request-0001",
        content: "hello",
        modelId: OPUS_MODEL_ID,
        reasoningEffort: "max",
      }),
    );

  const auditInput = (): ChatLedgerAuditInput => ({
    users: [{ id: "user" }],
    conversations: [{ id: "conversation", userId: "user" }],
    turns: [
      {
        ...turn,
        clientRequestId: "request",
        inputHash: "hash",
        activeConversationId: null,
      } as never,
    ],
    attempts: [attempt as never],
    entries: [
      {
        id: "reserve",
        operationKey: "reserve:attempt",
        kind: "chat.reserve",
        userId: "user",
        turnId: "turn",
        attemptId: "attempt",
        turnSettlementKey: null,
        availableDelta: -0.6,
        heldDelta: 0.6,
        consumedDelta: 0,
      },
      { id: "close", ...entries[0] } as never,
    ],
    receipts: [
      {
        id: "receipt",
        userId: "user",
        scope: "create",
        clientRequestId: "request",
        inputHash: "hash",
        conversationId: "conversation",
        turnId: "turn",
        attemptId: "attempt",
        contentClearedAt: null,
      },
    ],
    usages: [tx.usageLog.create.mock.calls[0][0].data],
  });

  it("reserves the prepared request dynamically and freezes rates at admission", async () => {
    const result = await create();
    const frozen = (turn.configSnapshot as { tokenPricing: typeof snapshot })
      .tokenPricing;
    const contextRequest = mocks.context.mock.calls[0][0];
    const bound = chatInputTokenUpperBound(
      contextRequest.buildRequest([contextRequest.latestMessage]),
    );
    expect(frozen.maxInputTokens).toBe(bound * 2 + 32_768);
    expect(frozen.maxOutputTokens).toBe(16_384 * 2);
    expect(result.priceCredits).toBe(chatTokenReserve(frozen));
    expect(turn.configSnapshot).toMatchObject({
      tokenRequestLimits: {
        maxInputTokens: 262_144,
        maxOutputTokens: 16_384,
        maxRequests: 2,
      },
    });
    expect(mocks.debit).toHaveBeenCalledExactlyOnceWith(
      tx,
      "user",
      result.priceCredits,
    );
    expect(mocks.context.mock.calls[0][0].skipCompaction).toBe(true);
    const config = await mocks.profile();
    config.tokenPricing.pricing.output = 999;
    expect(frozen.pricing.output).toBe(500);
    expect(frozen.pricing.input).toBe(100);
    expect((turn.configSnapshot as { effort: string }).effort).toBe("max");
    expect(String(entries[0].heldDelta)).toBe(String(result.priceCredits));
  });

  it("rejects a changed context before reserving funds", async () => {
    tx.conversation.findFirst.mockResolvedValue({
      id: "conversation",
      contextRevision: 1,
    });
    await expect(create()).rejects.toThrow("历史消息已变化");
    expect(mocks.debit).not.toHaveBeenCalled();
    expect(entries).toHaveLength(0);
  });

  it("settles exactly the verified cost, refunds the difference and persists all audit projections", async () => {
    expect(await finish()).toBe(true);
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith(tx, "user", 0.584905);
    expect(balance).toBe(9.984905);
    expect(turn.chargedCredits).toBe(0.015095);
    const close = entries[0];
    expect(close.kind).toBe("chat.settle");
    expect(String(close.availableDelta)).toBe("0.584905");
    expect(String(close.heldDelta)).toBe("-0.6");
    expect(String(close.consumedDelta)).toBe("0.015095");
    expect(close.result).toMatchObject({
      state: "charged",
      chargedCredits: 0.015095,
      tokens: { outputTokens: 1 },
      tokenPricing: snapshot,
    });
    expect(tx.usageLog.create.mock.calls[0][0].data).toMatchObject({
      creditsDelta: -0.015095,
      metadata: { usage: { billing: { chargedCredits: 0.015095 } } },
    });
    expect(attempt.usage).toMatchObject({
      claude_cache_creation_5_m_tokens: 227,
      billing: { state: "charged", tokens: { uncachedInputTokens: 8 } },
    });
    expect(
      tx.conversationMessage.updateMany.mock.calls[0][0].data.chatUsage,
    ).toEqual(attempt.usage);
    expect(
      tx.chatEvent.create.mock.calls.at(-1)?.[0].data.payload.billing,
    ).toMatchObject({ chargedCredits: 0.015095, balance: 9.984905 });
    expect(await finish()).toBe(false);
    expect(entries).toHaveLength(1);
    expect(tx.usageLog.create).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].sql).toContain('"ChatTurn"');
    expect(tx.$queryRaw.mock.calls[1][0].sql).toContain('"ChatAttempt"');
  });

  it.each([null, {}, { prompt_tokens: 10 }])(
    "releases rather than inventing a fee for unknown usage %j",
    async (unknown) => {
      await finish({ usage: unknown });
      expect(attempt.billingState).toBe("usage_unknown");
      expect(turn.status).toBe("completed");
      expect(turn.chargedCredits).toBe(0);
      expect(balance).toBe(10);
      expect(entries[0]).toMatchObject({
        kind: "chat.release",
        turnSettlementKey: null,
        result: {
          state: "usage_unknown",
          usageAvailability: "unknown",
          chargedCredits: 0,
        },
      });
      expect(tx.usageLog.create.mock.calls[0][0].data.creditsDelta).toBe(0);
    },
  );

  it.each([
    { prompt_tokens: 1001, completion_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: 1001 },
    { prompt_tokens: 1_000_000_000, completion_tokens: 1_000_000_000 },
  ])(
    "preserves abnormal reports but never charges above the accepted limits %j",
    async (invalid) => {
      await finish({ usage: invalid });
      expect(attempt.billingState).toBe("usage_invalid");
      expect(attempt.usage).toMatchObject({
        ...invalid,
        billing: {
          state: "usage_invalid",
          reason: "usage_exceeds_reserved_bounds",
          actualUsageCredits: expect.any(Number),
        },
      });
      expect(turn.chargedCredits).toBe(0);
      expect(balance).toBe(10);
      expect(entries[0].kind).toBe("chat.release");
    },
  );

  it.each(["failed", "cancelled", "interrupted", "incomplete"] as const)(
    "preserves full refund for %s",
    async (status) => {
      await finish({ status });
      expect(mocks.refund).toHaveBeenCalledExactlyOnceWith(tx, "user", 0.6);
      expect(attempt.billingState).toBe("released");
      expect(entries[0].kind).toBe("chat.release");
      expect(tx.usageLog.create).not.toHaveBeenCalled();
    },
  );

  it("keeps GPT success fixed at its hold when no token snapshot exists", async () => {
    turn.modelId = "default";
    turn.configSnapshot = { model: "legacy" };
    await finish({ usage: null });
    expect(turn.chargedCredits).toBe(0.6);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(String(entries[0].availableDelta)).toBe("0");
  });

  it("guards stale worker tokens and an already-closed hold", async () => {
    expect(await finish({ executionToken: "stale" })).toBe(false);
    expect(mocks.refund).not.toHaveBeenCalled();
    entries.push({ operationKey: "close:attempt" });
    await expect(finish()).rejects.toThrow("CHAT_HOLD_ALREADY_CLOSED");
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("rejects excess actual fees at the ledger boundary before mutating balance", async () => {
    await expect(
      closeChatReserve(tx as unknown as Prisma.TransactionClient, {
        userId: "user",
        turnId: "turn",
        attemptId: "attempt",
        amount: 0.6,
        success: true,
        actualCredits: 0.7,
      }),
    ).rejects.toThrow("CHAT_SETTLEMENT_EXCEEDS_RESERVE");
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(entries).toHaveLength(0);
  });

  it("produces a balanced audit with a partial consumption and refund", async () => {
    await finish();
    const report = auditChatLedger(auditInput());
    expect(report).toMatchObject({
      clean: true,
      quiescent: true,
      totals: { consumed: "0.015095", ledgerHeld: "0.000000" },
    });
    delete entries[0].result;
    expect(auditChatLedger(auditInput()).clean).toBe(true);
  });

  it.each([null, { prompt_tokens: 1001, completion_tokens: 1 }])(
    "audits a fully released unbillable completion %j",
    async (reportedUsage) => {
      await finish({ usage: reportedUsage });
      expect(auditChatLedger(auditInput())).toMatchObject({
        clean: true,
        totals: { consumed: "0.000000", ledgerHeld: "0.000000" },
      });
      delete entries[0].result;
      expect(auditChatLedger(auditInput()).clean).toBe(true);
    },
  );

  it("bills all reported recovery segments and refuses to bill a partial usage history", async () => {
    await finish({ usage: { usage_segments: [usage, usage] } });
    expect(turn.chargedCredits).toBe(0.03019);
    expect(auditChatLedger(auditInput()).clean).toBe(true);
  });
});
