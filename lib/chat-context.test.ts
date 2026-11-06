import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextSnapshot } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  findConversation: vi.fn(),
  findSnapshots: vi.fn(),
  upsert: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
  profile: vi.fn(),
  references: vi.fn(),
  fetch: vi.fn(),
  redisReady: vi.fn(),
  redis: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    conversation: { findFirst: mocks.findConversation },
    contextSnapshot: { findMany: mocks.findSnapshots },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/redis", () => ({
  assertRedisReady: mocks.redisReady,
  getRedis: mocks.redis,
}));
vi.mock("@/lib/ai-config", () => ({
  getConversationSystemPrompt: async () => "Server-owned system prompt",
}));
vi.mock("@/lib/chat-profiles", () => ({ getChatProfile: mocks.profile }));
vi.mock("@/lib/chat-references", () => ({
  resolveChatReferences: mocks.references,
}));

import {
  compactChatContext,
  finalizeChatContextManifest,
  getChatContextStatus,
  prepareChatContext,
} from "@/lib/chat-context";
import type { ContextHistory } from "@/lib/chat-context-history";
import {
  chatRequestHash,
  estimateChatRequestTokens,
} from "@/lib/chat-context-manifest";
import {
  estimateMessageTokens,
  MAX_SUMMARY_INPUT_TOKENS,
  summaryInputTokens,
} from "@/lib/chat-context-summary";
import { chatSystemInstructions } from "@/lib/chat-instructions";
import type { ChatReference } from "@/lib/chat-references-types";
import type { UpstreamChatMessage } from "@/lib/chat-upstream";
import { SOL_MODEL_ID } from "@/lib/chat-model-options";
import { CHAT_SOL_CONTEXT_BUDGET_TOKENS } from "@/lib/chat-context-types";

const input = {
  userId: "alice",
  conversationId: "chat-a",
  modelId: "gpt-5.6-luna",
};
const latestMessage: UpstreamChatMessage = {
  role: "user",
  content: "Current request",
};
const key = (user = input.userId, id = input.conversationId) =>
  JSON.stringify([user, id]);
let histories: Map<string, ContextHistory>;
let snapshots: ContextSnapshot[];
let transactionActive: boolean;

function history(
  count = 10,
  assistantCount = 1,
  content = "Original facts and constraints. ".repeat(50),
): ContextHistory {
  const result: ContextHistory = {
    id: input.conversationId,
    contextRevision: 0,
    messages: [],
    chatTurns: [],
  };
  for (let index = 0; index < count; index += 1) {
    const turnId = `turn-${index}`;
    const attemptId = `attempt-${index}`;
    result.chatTurns.push({
      id: turnId,
      status: "completed",
      activeAttemptId: attemptId,
      attempts: [
        {
          id: attemptId,
          ordinal: 1,
          status: "completed",
          parts: null,
          sources: null,
        },
      ],
    });
    for (let part = 0; part <= assistantCount; part += 1)
      result.messages.push({
        id: `${turnId}-${part}`,
        role: part === 0 ? "USER" : "ASSISTANT",
        content: `${turnId} part ${part}: ${content}`,
        chatTurnId: turnId,
        chatAttemptId: part === 0 ? null : attemptId,
        chatStatus: "completed",
        chatReferences: null,
        chatSources: null,
        generation: null,
      });
  }
  return result;
}
const own = () => histories.get(key())!;
function addCurrent(content = "Current request") {
  const row: ContextHistory["messages"][number] = {
    id: "current-user",
    role: "USER",
    content,
    chatTurnId: "current-turn",
    chatAttemptId: null,
    chatStatus: "completed",
    chatReferences: null,
    chatSources: null,
    generation: null,
  };
  own().messages.push(row, {
    ...row,
    id: "current-assistant",
    role: "ASSISTANT",
    content: "",
    chatAttemptId: "current-attempt",
    chatStatus: "running",
  });
  own().chatTurns.push({
    id: "current-turn",
    status: "running",
    activeAttemptId: "current-attempt",
    attempts: [
      {
        id: "current-attempt",
        ordinal: 1,
        status: "running",
        parts: null,
        sources: null,
      },
    ],
  });
  return row;
}
function summaryResponse(
  text = "Earlier decisions and confirmed constraints.",
) {
  return new Response(
    `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text }],
          },
        ],
      },
    })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
const body = (index = 0) => JSON.parse(mocks.fetch.mock.calls[index][1].body);
const summaryData = (index = 0) =>
  JSON.parse(body(index).input[0].content[0].text);

beforeEach(() => {
  vi.resetAllMocks();
  histories = new Map([[key(), history()]]);
  snapshots = [];
  transactionActive = false;
  mocks.findConversation.mockImplementation(async ({ where }) => {
    expect(where.archivedAt).toBeNull();
    return structuredClone(histories.get(key(where.userId, where.id)) ?? null);
  });
  mocks.findSnapshots.mockImplementation(async ({ where }) =>
    structuredClone(
      snapshots.filter(
        (row) =>
          row.conversationId === where.conversationId &&
          row.estimatorVersion === where.estimatorVersion &&
          (!where.summarizerProfileVersion ||
            row.summarizerProfileVersion === where.summarizerProfileVersion),
      ),
    ),
  );
  mocks.upsert.mockImplementation(async ({ create }) => {
    expect(transactionActive).toBe(true);
    const existing = snapshots.find(
      (row) =>
        row.conversationId === create.conversationId &&
        row.sourceHash === create.sourceHash &&
        row.summarizerProfileVersion === create.summarizerProfileVersion &&
        row.estimatorVersion === create.estimatorVersion,
    );
    if (existing) return structuredClone(existing);
    const row = {
      ...structuredClone(create),
      id: `snapshot-${snapshots.length}`,
      pinnedConstraints: null,
      createdAt: new Date(),
    };
    snapshots.push(row);
    return structuredClone(row);
  });
  mocks.transaction.mockImplementation(async (callback) => {
    transactionActive = true;
    try {
      return await callback({
        $queryRaw: mocks.lock,
        conversation: { findFirst: mocks.findConversation },
        contextSnapshot: { upsert: mocks.upsert },
      });
    } finally {
      transactionActive = false;
    }
  });
  mocks.profile.mockResolvedValue({
    enabled: true,
    apiKey: "mock-secret",
    baseUrl: "https://provider.invalid/v1",
    model: input.modelId,
    transport: "responses_sse",
    vision: true,
  });
  mocks.fetch.mockImplementation(async () => {
    expect(transactionActive).toBe(false);
    return summaryResponse();
  });
  mocks.references.mockImplementation(
    async (_user: string, references: ChatReference[]) =>
      references.map((reference) => ({
        type: "image_url",
        image_url: {
          url: `data:image/mock;${reference.kind === "upload" ? reference.key : reference.id}`,
          detail: "auto",
        },
      })),
  );
  mocks.redis.mockImplementation(() => {
    throw new Error("Redis is unavailable");
  });
  mocks.redisReady.mockRejectedValue(new Error("Redis is unavailable"));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("durable server-owned context", () => {
  it("keeps Sol history beyond twenty turns and accepts input above the legacy budget", async () => {
    histories.set(key(), history(24, 1, "Confirmed short facts. ".repeat(4)));
    const prepared = await prepareChatContext({
      ...input,
      modelId: SOL_MODEL_ID,
      latestMessage: { role: "user", content: "a".repeat(120_000) },
    });
    expect(prepared.status.budgetTokens).toBe(CHAT_SOL_CONTEXT_BUDGET_TOKENS);
    expect(prepared.manifest.budgetTokens).toBe(CHAT_SOL_CONTEXT_BUDGET_TOKENS);
    expect(prepared.messages).toHaveLength(49);
    expect(prepared.compacted).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(
      (
        await getChatContextStatus(
          input.userId,
          input.conversationId,
          SOL_MODEL_ID,
        )
      ).budgetTokens,
    ).toBe(CHAT_SOL_CONTEXT_BUDGET_TOKENS);
  });

  it("compacts Sol at its usage threshold while retaining its larger budget", async () => {
    histories.set(key(), history(8, 1, "a".repeat(19_000)));
    const prepared = await prepareChatContext({
      ...input,
      modelId: SOL_MODEL_ID,
      latestMessage,
    });
    expect(prepared.compacted).toBe(true);
    expect(prepared.status.estimatedTokens).toBeLessThan(
      CHAT_SOL_CONTEXT_BUDGET_TOKENS * 0.75,
    );
    expect(prepared.manifest.budgetTokens).toBe(CHAT_SOL_CONTEXT_BUDGET_TOKENS);
    expect(prepared.manifest.snapshotId).not.toBeNull();
  });

  it("still rejects a Sol input above its application budget without sending it", async () => {
    histories.set(key(), history(0));
    await expect(
      prepareChatContext({
        ...input,
        modelId: SOL_MODEL_ID,
        latestMessage: {
          role: "user",
          content: "a".repeat(CHAT_SOL_CONTEXT_BUDGET_TOKENS * 4),
        },
      }),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_TOO_LARGE" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("prepares short dialogue and reports status with Redis completely unavailable", async () => {
    histories.set(key(), history(1));
    const original = structuredClone(own());
    const prepared = await prepareChatContext({ ...input, latestMessage });
    expect(prepared.messages.slice(0, 2).map((item) => item.content)).toEqual(
      own().messages.map((row) => row.content),
    );
    expect(prepared.messages.at(-1)).toEqual(latestMessage);
    expect(prepared.manifest.snapshotId).toBeNull();
    expect(
      await getChatContextStatus(input.userId, input.conversationId),
    ).toMatchObject({ messageCount: 2, summary: null });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.redis).not.toHaveBeenCalled();
    expect(mocks.redisReady).not.toHaveBeenCalled();
    expect(own()).toEqual(original);
  });

  it("includes assembled instructions in the estimate and rejects an oversized current message before summary", async () => {
    histories.set(key(), history(0));
    const systemTokens = Math.max(
      ...[false, true].map((search) =>
        estimateMessageTokens([
          {
            role: "system",
            content: chatSystemInstructions(
              "Server-owned system prompt",
              search,
            ),
          },
        ]),
      ),
    );
    expect(
      (await getChatContextStatus(input.userId, input.conversationId))
        .estimatedTokens,
    ).toBe(systemTokens);
    await expect(
      prepareChatContext({
        ...input,
        latestMessage: { role: "user", content: "a".repeat(95_800) },
      }),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_TOO_LARGE" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("commits a PG snapshot only after summary, under a conversation lock, then reuses it without Redis", async () => {
    const first = await compactChatContext(input);
    expect(first).toMatchObject({
      compactedMessages: 12,
      messageCount: 20,
      canCompact: false,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(mocks.lock.mock.calls[0][0].values).toEqual([
      input.conversationId,
      input.userId,
    ]);
    expect(snapshots[0]).toMatchObject({
      revision: 0,
      throughTurnId: "turn-5",
      summary: first.summary,
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      estimatorVersion: "chat-budget-v2",
      summarizerProfileVersion: expect.stringContaining(input.modelId),
    });
    expect(snapshots[0].attachmentManifest).toMatchObject({
      turnKeys: Array.from({ length: 6 }, (_, i) => `turn-${i}`),
    });
    const prepared = await prepareChatContext({ ...input, latestMessage });
    expect(prepared.manifest.snapshotId).toBe(snapshots[0].id);
    expect(prepared.compacted).toBe(false);
    expect(await compactChatContext(input)).toEqual(first);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.redis).not.toHaveBeenCalled();
    expect(JSON.stringify(prepared.manifest)).not.toContain("mock-secret");
  });

  it.each(["edit", "delete", "replace", "references", "sources", "clear"])(
    "invalidates a snapshot on %s even if a mutation forgot to increment revision",
    async (change) => {
      await compactChatContext(input);
      if (change === "edit")
        own().messages[0].content = "Edited content, same ID";
      if (change === "delete") own().messages.splice(0, 1);
      if (change === "replace") own().messages[0].id = "new-id";
      if (change === "references")
        own().messages[0].chatReferences = [
          { kind: "upload", key: "uploads/alice/changed.png" },
        ];
      if (change === "sources")
        own().messages[1].chatSources = [
          { url: "https://source.invalid/edited", title: "Changed" },
        ];
      if (change === "clear") {
        own().messages = [];
        own().chatTurns = [];
      }
      const original = structuredClone(own());
      expect(
        await getChatContextStatus(
          input.userId,
          input.conversationId,
          input.modelId,
        ),
      ).toMatchObject({ summary: null, compactedMessages: 0 });
      expect(own()).toEqual(original);
      expect(snapshots).toHaveLength(1);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("reuses a source-verified prefix after appends advance the conversation revision", async () => {
    await compactChatContext(input);
    const originalId = snapshots[0].id;
    addCurrent();
    own().contextRevision += 1;
    const prepared = await prepareChatContext({
      ...input,
      latestMessage,
      currentTurnId: "current-turn",
    });
    expect(prepared.manifest).toMatchObject({
      snapshotId: originalId,
      revision: 1,
      currentMessageId: "current-user",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rechecks ownership before every snapshot read", async () => {
    await compactChatContext(input);
    await expect(
      getChatContextStatus("bob", input.conversationId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    histories.delete(key());
    await expect(
      getChatContextStatus(input.userId, input.conversationId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(snapshots).toHaveLength(1);
  });

  it("does not reuse corrupted metadata or a different summarizer/estimator version", async () => {
    await compactChatContext(input);
    snapshots[0].attachmentManifest = { version: 1, turnKeys: ["wrong"] };
    expect(
      (
        await getChatContextStatus(
          input.userId,
          input.conversationId,
          input.modelId,
        )
      ).summary,
    ).toBeNull();
    snapshots[0].estimatorVersion = "old";
    expect(
      (
        await getChatContextStatus(
          input.userId,
          input.conversationId,
          input.modelId,
        )
      ).summary,
    ).toBeNull();
    expect(
      (
        await getChatContextStatus(
          input.userId,
          input.conversationId,
          "gpt-6.1-sol",
        )
      ).summary,
    ).toBeNull();
  });

  it.each(["edit", "delete", "clear", "append", "revision", "remove"])(
    "does not publish an in-flight summary after %s at the commit barrier",
    async (change) => {
      mocks.lock.mockImplementationOnce(async () => {
        if (change === "edit") own().messages[0].content = "Changed";
        if (change === "delete") own().messages.splice(0, 1);
        if (change === "clear") {
          own().messages = [];
          own().chatTurns = [];
        }
        if (change === "append") addCurrent();
        if (change === "revision") own().contextRevision += 1;
        if (change === "remove") histories.delete(key());
      });
      await expect(compactChatContext(input)).rejects.toMatchObject({
        code: change === "remove" ? "NOT_FOUND" : "CHAT_CONTEXT_CHANGED",
      });
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(snapshots).toHaveLength(0);
    },
  );
});

describe("complete turns, current identity and retained evidence", () => {
  it("retains four complete multi-message turns rather than eight arbitrary messages", async () => {
    histories.set(key(), history(7, 3));
    const result = await prepareChatContext({
      ...input,
      latestMessage,
      forceCompact: true,
    });
    expect(result.manifest.summaryMessageIds).toHaveLength(12);
    expect(result.manifest.recentMessageIds).toEqual(
      own()
        .messages.slice(12)
        .map((row) => row.id),
    );
    expect(result.messages).toHaveLength(18);
    expect(result.messages[1]).toMatchObject({
      role: "user",
      content: own().messages[12].content,
    });
    expect(result.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: own().messages.at(-1)!.content,
    });
    expect(snapshots[0].throughTurnId).toBe("turn-2");
  });

  it("groups legacy USER plus all following ASSISTANT messages into complete turns", async () => {
    histories.set(key(), history(7, 2));
    own().chatTurns = [];
    own().messages.forEach((row) => {
      row.chatTurnId = null;
      row.chatAttemptId = null;
      row.chatStatus = null;
    });
    const result = await prepareChatContext({
      ...input,
      latestMessage,
      forceCompact: true,
    });
    expect(result.status.compactedMessages).toBe(9);
    expect(result.manifest.recentMessageIds).toEqual(
      own()
        .messages.slice(9)
        .map((row) => row.id),
    );
    expect(result.messages[1].role).toBe("user");
    expect(snapshots[0].throughTurnId).toBeNull();
  });

  it("replaces only the persisted current USER ID and preserves identical earlier requests", async () => {
    histories.set(key(), history(1));
    own().messages[0].content = "repeat";
    addCurrent("repeat");
    const current: UpstreamChatMessage = {
      role: "user",
      content: [
        { type: "text", text: "repeat" },
        { type: "image_url", image_url: { url: "data:image/mock;one" } },
      ],
    };
    const result = await prepareChatContext({
      ...input,
      latestMessage: current,
      latestMessageId: "current-user",
      references: [{ kind: "upload", key: "uploads/alice/one.png" }],
    });
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content).toBe("repeat");
    expect(result.manifest.messageIds).toEqual([
      "turn-0-0",
      "turn-0-1",
      "current-user",
    ]);
    expect(result.manifest.excludedMessageIds).toEqual(["current-assistant"]);
    expect(result.manifest.unattributedImageCount).toBe(0);
    expect(mocks.references).not.toHaveBeenCalled();
    expect(current.content).toHaveLength(2);
  });

  it("never infers persisted identity by text when no current ID is supplied", async () => {
    histories.set(key(), history(0));
    addCurrent("repeat");
    const result = await prepareChatContext({
      ...input,
      latestMessage: { role: "user", content: "repeat" },
    });
    expect(result.messages.filter((row) => row.role === "user")).toHaveLength(
      2,
    );
    expect(result.manifest.currentMessageId).toBeNull();
  });

  it.each(["missing", "turn-0-1", "turn-0-0"])(
    "rejects an invalid or stale current message identity: %s",
    async (id) => {
      addCurrent();
      await expect(
        prepareChatContext({ ...input, latestMessage, latestMessageId: id }),
      ).rejects.toMatchObject({ code: "CHAT_CONTEXT_CHANGED" });
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("excludes failed fragments and their evidence but retains explicitly unfulfilled user requirements", async () => {
    own().chatTurns[0].status = "failed";
    own().chatTurns[0].attempts[0].status = "failed";
    own().messages[1].chatStatus = "failed";
    own().messages[1].content = "FALSE_SUCCESS_FACT";
    own().messages[1].chatSources = [
      { url: "https://failed.invalid", title: "Failed evidence" },
    ];
    own().chatTurns[0].attempts[0].parts = [
      { type: "function_call_output", output: "FALSE_TOOL_FACT" },
    ];
    const result = await prepareChatContext({
      ...input,
      latestMessage,
      forceCompact: true,
    });
    expect(result.manifest.excludedMessageIds).toContain("turn-0-1");
    expect(result.manifest.summaryMessageIds).toContain("turn-0-0");
    expect(JSON.stringify(summaryData())).toContain("不代表已执行成功");
    expect(JSON.stringify(summaryData())).not.toMatch(
      /FALSE_SUCCESS_FACT|FALSE_TOOL_FACT|failed\.invalid/,
    );
    expect(JSON.stringify(result.manifest)).not.toMatch(
      /FALSE_SUCCESS_FACT|FALSE_TOOL_FACT|failed\.invalid/,
    );
  });

  it("preserves compacted images in mixed source order, together with sanitized tool/source manifests", async () => {
    const references: ChatReference[] = [
      { kind: "generated", id: "image-b", label: "first" },
      { kind: "upload", key: "uploads/alice/ref.png", label: "second" },
      { kind: "generated", id: "image-a", label: "third" },
    ];
    own().messages[0].chatReferences = references;
    own().messages[1].chatSources = [
      {
        url: "https://evidence.invalid/report",
        title: "Report",
        authorization: "secret",
      },
      { url: "javascript:alert(1)", title: "Unsafe" },
      { url: "https://name:password@evidence.invalid", title: "Credentials" },
    ];
    own().chatTurns[0].attempts[0].parts = [
      {
        type: "web_search_call",
        id: "search-1",
        status: "completed",
        action: { query: "source query" },
        headers: { authorization: "PRIVATE" },
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "Confirmed tool result",
        private_field: "PRIVATE",
      },
      { type: "reasoning", text: "HIDDEN_REASONING" },
      {
        type: "tool_result",
        status: "failed",
        output: "FALSE_TOOL_FACT",
        sources: [{ url: "https://bad-tool.invalid" }],
      },
    ];
    const result = await prepareChatContext({
      ...input,
      latestMessage,
      forceCompact: true,
    });
    const imageUrls = result.messages.flatMap((row) =>
      typeof row.content === "string"
        ? []
        : row.content.flatMap((part) =>
            part.type === "image_url" ? [part.image_url.url] : [],
          ),
    );
    expect(imageUrls).toEqual([
      "data:image/mock;image-b",
      "data:image/mock;uploads/alice/ref.png",
      "data:image/mock;image-a",
    ]);
    expect(result.manifest.assets.map((asset) => asset.reference)).toEqual(
      references,
    );
    expect(result.manifest.assets.every((asset) => asset.compacted)).toBe(true);
    expect(result.manifest.toolResultManifest[0]).toMatchObject({
      messageId: "turn-0-1",
      sources: [{ url: "https://evidence.invalid/report", title: "Report" }],
      tools: [
        {
          type: "web_search_call",
          itemId: "search-1",
          query: "source query",
          status: "completed",
        },
        {
          type: "function_call_output",
          callId: "call-1",
          text: "Confirmed tool result",
        },
        { type: "tool_result", status: "failed" },
      ],
    });
    expect(JSON.stringify(result.manifest)).not.toMatch(
      /PRIVATE|HIDDEN_REASONING|FALSE_TOOL_FACT|javascript|password|bad-tool/,
    );
    expect(JSON.stringify(snapshots[0].attachmentManifest)).toContain(
      "image-b",
    );
    expect(JSON.stringify(snapshots[0].toolResultManifest)).toContain("call-1");
    expect(JSON.stringify(summaryData())).not.toContain("data:image");
    expect(mocks.references).toHaveBeenCalledWith("alice", references);
  });

  it("rehydrates legacy stored arrays and lets an explicit ordered list replace them", async () => {
    histories.set(key(), history(1));
    own().messages[0].chatReferences = {
      referenceImageKeys: ["uploads/alice/old.png"],
      sourceImageIds: ["old-generated"],
    };
    const current = addCurrent();
    current.chatReferences = {
      references: [{ kind: "generated", id: "current" }],
      referenceImageKeys: ["uploads/alice/ignored.png"],
    };
    const result = await prepareChatContext({
      ...input,
      latestMessage,
      currentTurnId: "current-turn",
    });
    expect(result.manifest.assets.map((asset) => asset.reference)).toEqual([
      { kind: "upload", key: "uploads/alice/old.png" },
      { kind: "generated", id: "old-generated" },
      { kind: "generated", id: "current" },
    ]);
    expect(result.manifest.assets.at(-1)?.messageId).toBe("current-user");
  });

  it("retains completed legacy generation outputs as real ordered image attachments", async () => {
    histories.set(key(), history(1));
    own().chatTurns = [];
    own().messages.forEach((row) => {
      row.chatTurnId = null;
      row.chatAttemptId = null;
      row.chatStatus = null;
    });
    own().messages[1].generation = {
      status: "SUCCEEDED",
      deletedAt: null,
      images: [{ id: "output-b" }, { id: "output-a" }],
    };
    const result = await prepareChatContext({ ...input, latestMessage });
    expect(result.manifest.assets.map((asset) => asset.reference)).toEqual([
      { kind: "generated", id: "output-b" },
      { kind: "generated", id: "output-a" },
    ]);
    expect(mocks.references).toHaveBeenCalledWith("alice", [
      { kind: "generated", id: "output-b" },
      { kind: "generated", id: "output-a" },
    ]);
    expect(result.messages[1].role).toBe("assistant");
    expect(result.messages[2].role).toBe("user");
    expect(
      result.messages.every(
        (message) =>
          message.role !== "assistant" || typeof message.content === "string",
      ),
    ).toBe(true);
  });

  it.each(["PENDING", "RUNNING", "FAILED", "CANCELED"] as const)(
    "does not turn a %s image job placeholder into success facts",
    async (status) => {
      histories.set(key(), history(1));
      own().chatTurns = [];
      own().messages.forEach((row) => {
        row.chatTurnId = null;
        row.chatAttemptId = null;
        row.chatStatus = null;
      });
      own().messages[1].content = "FALSE_IMAGE_SUCCESS";
      own().messages[1].generation = {
        status,
        deletedAt: null,
        images: [{ id: "partial-image" }],
      };
      const result = await prepareChatContext({ ...input, latestMessage });
      expect(JSON.stringify(result.messages)).not.toContain(
        "FALSE_IMAGE_SUCCESS",
      );
      expect(result.manifest.assets).toHaveLength(0);
      expect(result.manifest.excludedMessageIds).toContain("turn-0-1");
      expect(mocks.references).not.toHaveBeenCalled();
    },
  );

  it.each(["history", "current", "inline"])(
    "rejects unverified Sol vision before summary or image reads: %s",
    async (location) => {
      mocks.profile.mockResolvedValue({ vision: false });
      if (location === "history")
        own().messages[0].chatReferences = [
          { kind: "upload", key: "uploads/alice/old.png" },
        ];
      await expect(
        prepareChatContext({
          ...input,
          modelId: "gpt-6.1-sol",
          forceCompact: true,
          latestMessage:
            location === "inline"
              ? {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: { url: "data:image/mock;one" },
                    },
                  ],
                }
              : latestMessage,
          ...(location === "current"
            ? {
                references: [
                  { kind: "generated" as const, id: "current-image" },
                ],
              }
            : {}),
        }),
      ).rejects.toMatchObject({ code: "CHAT_CONTEXT_VISION_UNAVAILABLE" });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.references).not.toHaveBeenCalled();
    },
  );
});

describe("bounded, immutable attempt preparation", () => {
  it("returns a deeply immutable detached manifest and binds the exact final request body", async () => {
    histories.set(key(), history(1));
    const references: ChatReference[] = [
      { kind: "upload", key: "uploads/alice/current.png", label: "original" },
    ];
    const result = await prepareChatContext({
      ...input,
      latestMessage,
      references,
      profileVersion: "profile-42",
    });
    expect(result.manifest.requestHash).toBeNull();
    expect(Object.isFrozen(result.manifest.assets[0].reference)).toBe(true);
    references[0].label = "mutated";
    expect(result.manifest.assets[0].reference.label).toBe("original");
    const request = {
      model: "test",
      instructions: "frozen instructions",
      input: result.messages,
      tools: [{ type: "web_search" }],
      stream: true,
    };
    const manifest = finalizeChatContextManifest(
      result.manifest,
      JSON.stringify(request),
      "profile-43",
    );
    expect(manifest).toMatchObject({
      profileVersion: "profile-43",
      requestHash: chatRequestHash(request),
      estimatedTokens: estimateChatRequestTokens(request),
    });
    expect(manifest.requestHash).not.toBe(manifest.contextHash);
    expect(result.manifest.requestHash).toBeNull();
    expect(manifest.estimatedTokens).toBeLessThan(10_000);
  });

  it("can finalize in prepare using the worker's request builder and includes image/tool costs", async () => {
    histories.set(key(), history(0));
    const buildRequest = (messages: UpstreamChatMessage[]) => ({
      model: "test",
      messages,
      tools: [
        {
          type: "function",
          function: { name: "test", description: "tool definition" },
        },
      ],
      stream: true,
    });
    const result = await prepareChatContext({
      ...input,
      latestMessage,
      buildRequest,
    });
    expect(result.manifest.requestHash).toBe(
      chatRequestHash(buildRequest(result.messages)),
    );
    expect(result.status.estimatedTokens).toBe(result.manifest.estimatedTokens);
    await expect(
      prepareChatContext({
        ...input,
        latestMessage,
        buildRequest: (messages) => ({
          messages,
          instructions: "a".repeat(100_000),
        }),
      }),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_TOO_LARGE" });
  });

  it("bounds summary calls and publishes progress only at complete-turn boundaries", async () => {
    histories.set(key(), history(50, 1, "中".repeat(1_500)));
    await expect(
      prepareChatContext({ ...input, latestMessage }),
    ).rejects.toMatchObject({
      code: "CHAT_CONTEXT_TOO_LARGE",
      contextStatus: { canCompact: true },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(snapshots).toHaveLength(1);
    const first = await getChatContextStatus(
      input.userId,
      input.conversationId,
      input.modelId,
    );
    expect(first.compactedMessages).toBeGreaterThan(0);
    expect(first.compactedMessages % 2).toBe(0);
    for (let i = 0; i < 4; i += 1)
      expect(
        summaryInputTokens(
          summaryData(i).messages,
          summaryData(i).previousSummary,
        ),
      ).toBeLessThanOrEqual(MAX_SUMMARY_INPUT_TOKENS);
    await compactChatContext(input);
    expect(summaryData(4).previousSummary).toBe(first.summary);
    expect(
      (
        await getChatContextStatus(
          input.userId,
          input.conversationId,
          input.modelId,
        )
      ).compactedMessages,
    ).toBeGreaterThan(first.compactedMessages);
  });

  it("summarizes a giant code reply without slicing the outgoing recent turn or saved original", async () => {
    histories.set(key(), history(4));
    own().messages[1].content = "<html>const value = 123;</html>"
      .repeat(5_000)
      .slice(0, 128_000);
    const original = structuredClone(own());
    const result = await prepareChatContext({ ...input, latestMessage });
    expect(result.status.compactedMessages).toBe(2);
    expect(result.status.estimatedTokens).toBeLessThanOrEqual(24_000);
    expect(result.messages.slice(1, -1).map((item) => item.content)).toEqual(
      own()
        .messages.slice(2)
        .map((row) => row.content),
    );
    expect(mocks.fetch.mock.calls.length).toBeLessThanOrEqual(4);
    expect(own()).toEqual(original);
  });

  it("never publishes a partial giant turn when the bounded summary budget cannot complete it", async () => {
    histories.set(key(), history(5));
    own().messages[0].content = "中".repeat(128_000);
    await expect(compactChatContext(input)).rejects.toMatchObject({
      code: "CHAT_CONTEXT_MESSAGE_TOO_LARGE",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(snapshots).toHaveLength(0);
    expect(own().messages[0].content).toHaveLength(128_000);
  });

  it("does not replace an existing snapshot if a later segment fails", async () => {
    await compactChatContext(input);
    const originalSnapshot = structuredClone(snapshots);
    const extra = history(20, 1, "中".repeat(1_500));
    extra.messages.forEach((row) => {
      row.id = `new-${row.id}`;
      row.chatTurnId = `new-${row.chatTurnId}`;
      row.chatAttemptId = row.chatAttemptId ? `new-${row.chatAttemptId}` : null;
    });
    extra.chatTurns.forEach((turn) => {
      turn.id = `new-${turn.id}`;
      turn.activeAttemptId = `new-${turn.activeAttemptId}`;
      turn.attempts[0].id = `new-${turn.attempts[0].id}`;
    });
    own().messages.push(...extra.messages);
    own().chatTurns.push(...extra.chatTurns);
    mocks.fetch
      .mockImplementationOnce(async () => summaryResponse())
      .mockResolvedValueOnce(new Response("private failure", { status: 502 }));
    await expect(compactChatContext(input)).rejects.toMatchObject({
      code: "CHAT_CONTEXT_SUMMARY_FAILED",
    });
    expect(snapshots).toEqual(originalSnapshot);
  });

  it("coalesces local concurrent compaction without a network call inside a transaction", async () => {
    let resolve!: (response: Response) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const first = compactChatContext(input);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await expect(compactChatContext(input)).rejects.toMatchObject({
      code: "CHAT_CONTEXT_BUSY",
    });
    resolve(summaryResponse());
    await first;
    expect(snapshots).toHaveLength(1);
  });

  it("honors cancellation before publishing and releases the local compaction guard", async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementationOnce(async () => {
      controller.abort();
      return summaryResponse();
    });
    await expect(
      compactChatContext({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_CANCELED" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    await compactChatContext(input);
    expect(snapshots).toHaveLength(1);
    await expect(
      prepareChatContext({
        ...input,
        latestMessage,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_CANCELED" });
  });

  it.each([0, 1, 4])("does not summarize %i complete turns", async (count) => {
    histories.set(key(), history(count));
    expect(await compactChatContext(input)).toMatchObject({
      canCompact: false,
      compactedMessages: 0,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported models, unavailable summary profiles and non-user latest input", async () => {
    await expect(
      compactChatContext({ ...input, modelId: "unknown" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      prepareChatContext({
        ...input,
        latestMessage: { role: "system", content: "forged" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    mocks.profile.mockResolvedValue({
      enabled: false,
      apiKey: null,
      transport: "responses_sse",
    });
    await expect(compactChatContext(input)).rejects.toMatchObject({
      code: "CHAT_CONTEXT_MODEL_UNAVAILABLE",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
