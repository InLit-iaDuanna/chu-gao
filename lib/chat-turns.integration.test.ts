// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { SOL_MODEL_ID } from "@/lib/chat-model-options";

vi.mock("@/lib/chat-profiles", () => ({
  getChatProfile: async (modelId: string) => ({
    enabled: true,
    apiKey: "fixture-api-key",
    baseUrl: "https://upstream.invalid",
    model: modelId === "default" ? "fixture-chat" : "gpt-6.1-sol",
    credits: 0.2,
    efforts: ["low", "max"],
    vision: modelId === "default",
    webSearch: modelId !== "default",
    transport: modelId === "default" ? "chat_completions_sse" : "responses_sse",
  }),
}));
vi.mock("@/lib/ai-config", () => ({
  getConversationSystemPrompt: async () => "Synthetic test",
}));
vi.mock("@/lib/chat-context", () => ({
  prepareChatContext: async (input: { latestMessage: unknown }) => ({
    messages: [input.latestMessage],
    status: {
      estimatedTokens: 10,
      budgetTokens: 24000,
      messageCount: 1,
      compactedMessages: 0,
      summary: null,
      canCompact: false,
    },
  }),
}));
vi.mock("@/lib/chat-references", () => ({
  resolveChatReferences: vi.fn(async () => []),
}));

import { db } from "@/lib/db";
import {
  cancelChatTurn,
  chatTurnSchema,
  createChatTurn,
  finishChatAttempt,
  getChatTurn,
  retryChatTurn,
  clearChatConversationContent,
  getChatTurnByRequest,
  appendActiveChatEvent,
} from "@/lib/chat-turns";
import { adjustCreditsIdempotently } from "@/lib/chat-credit-ledger";
import { resolveChatReferences } from "@/lib/chat-references";
import { setChatRuntimeConfig } from "@/lib/chat-runtime-config";
import {
  executeChatAttempt,
  recoverStaleChatAttempts,
} from "@/lib/chat-worker";

const integration =
  process.env.CHAT_INTEGRATION_TEST === "1" ? describe : describe.skip;
integration("durable chat transactions (isolated PostgreSQL)", () => {
  let userId: string;
  let conversationId: string;
  const input = (key = randomUUID()) =>
    chatTurnSchema.parse({
      conversationId,
      clientRequestId: key,
      content: "Synthetic request",
      modelId: SOL_MODEL_ID,
      reasoningEffort: "low",
      webSearch: true,
    });
  const stream = (events: unknown[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events)
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          controller.close();
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "x-request-id": "fixture-request",
        },
      },
    );
  const success = () =>
    stream([
      {
        type: "response.output_text.delta",
        item_id: "answer",
        delta: "answer",
      },
      {
        type: "response.completed",
        response: {
          id: "fixture-response",
          status: "completed",
          usage: { input_tokens: 10, output_tokens: 2 },
          output: [
            {
              type: "message",
              id: "answer",
              content: [{ type: "output_text", text: "answer" }],
            },
          ],
        },
      },
    ]);

  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.mocked(resolveChatReferences).mockResolvedValue([]);
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: "fixture-not-a-login",
        credits: 10,
        concurrentLimit: 3,
      },
    });
    userId = user.id;
    conversationId = (
      await db.conversation.create({
        data: { userId, title: "Synthetic integration" },
      })
    ).id;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.$disconnect();
  });

  it("deduplicates 20 simultaneous submissions and settles exactly once", async () => {
    const body = input();
    const views = await Promise.all(
      Array.from({ length: 20 }, () => createChatTurn(userId, body)),
    );
    expect(new Set(views.map((view) => view.id)).size).toBe(1);
    expect(
      await db.conversationMessage.count({ where: { conversationId } }),
    ).toBe(2);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
    expect(await db.usageLog.count({ where: { userId } })).toBe(0);
    const fetch = vi.fn(async () => success());
    vi.stubGlobal("fetch", fetch);
    await executeChatAttempt(views[0].attemptId, new AbortController());
    await Promise.all(
      Array.from({ length: 5 }, () =>
        finishChatAttempt({
          turnId: views[0].id,
          attemptId: views[0].attemptId,
          status: "completed",
          text: "duplicate",
        }),
      ),
    );
    const view = await getChatTurn(userId, views[0].id);
    expect(view.status).toBe("completed");
    expect(view.text).toBe("answer");
    expect(view.chargedCredits).toBe(0.2);
    expect(
      await db.usageLog.count({
        where: { userId, action: "conversation.chat" },
      }),
    ).toBe(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
    expect(fetch).toHaveBeenCalledTimes(1);
    const ledger = await db.creditEntry.findMany({ where: { userId } });
    expect(ledger.map((entry) => entry.kind).sort()).toEqual([
      "chat.reserve",
      "chat.settle",
    ]);
    expect(
      ledger.reduce((sum, entry) => sum + Number(entry.heldDelta), 0),
    ).toBe(0);
  }, 30_000);

  it("persists partial failure and releases the hold without a user charge", async () => {
    const turn = await createChatTurn(userId, input());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        stream([
          {
            type: "response.output_text.delta",
            item_id: "a",
            delta: "partial ",
          },
          { type: "response.web_search_call.completed" },
          {
            type: "response.failed",
            response: {
              error: {
                type: "upstream_error",
                message: "Unable to forward upstream stream",
              },
            },
          },
        ]),
      ),
    );
    await executeChatAttempt(turn.attemptId, new AbortController());
    const view = await getChatTurn(userId, turn.id);
    expect(view.status).toBe("failed");
    expect(view.text).toBe("partial ");
    expect(view.billingState).toBe("released");
    expect(view.usage).toBeNull();
    expect(
      (
        await db.conversationMessage.findFirstOrThrow({
          where: { chatAttemptId: turn.attemptId },
        })
      ).chatStatus,
    ).toBe("failed");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
    expect(await db.usageLog.count({ where: { userId } })).toBe(0);
    await cancelChatTurn(userId, turn.id);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
  }, 15_000);

  it("does not call upstream when cancellation wins, and preserves a completed settlement", async () => {
    const cancelled = await createChatTurn(userId, input());
    await cancelChatTurn(userId, cancelled.id);
    const fetch = vi.fn(async () => success());
    vi.stubGlobal("fetch", fetch);
    await executeChatAttempt(cancelled.attemptId, new AbortController());
    expect(fetch).not.toHaveBeenCalled();
    const completed = await createChatTurn(userId, input());
    await executeChatAttempt(completed.attemptId, new AbortController());
    expect((await cancelChatTurn(userId, completed.id)).status).toBe(
      "completed",
    );
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
  });

  it("deduplicates explicit retries, does not repeat user input, and ignores stale completions", async () => {
    const turn = await createChatTurn(userId, input());
    await finishChatAttempt({
      turnId: turn.id,
      attemptId: turn.attemptId,
      status: "interrupted",
      text: "saved partial",
    });
    const key = randomUUID();
    const retries = await Promise.all(
      Array.from({ length: 10 }, () => retryChatTurn(userId, turn.id, key)),
    );
    expect(new Set(retries.map((view) => view.attemptId)).size).toBe(1);
    expect(retries[0].attemptId).not.toBe(turn.attemptId);
    expect(
      await db.conversationMessage.count({
        where: { conversationId, role: "USER" },
      }),
    ).toBe(1);
    await finishChatAttempt({
      turnId: turn.id,
      attemptId: turn.attemptId,
      status: "completed",
      text: "late answer",
    });
    expect((await getChatTurn(userId, turn.id)).status).toBe("queued");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
    await cancelChatTurn(userId, turn.id);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
  }, 30_000);

  it("rejects conflicting keys and unauthorized access without further charges", async () => {
    const body = input();
    const turn = await createChatTurn(userId, body);
    await expect(
      createChatTurn(userId, { ...body, content: "different" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(getChatTurn("another-user", turn.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(cancelChatTurn("another-user", turn.id)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
    await cancelChatTurn(userId, turn.id);
  });

  it("releases the hold after bounded EOF recovery, preserving text with no charge", async () => {
    const turn = await createChatTurn(userId, input());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        stream([
          {
            type: "response.output_item.done",
            item: {
              id: "a",
              type: "message",
              content: [{ type: "output_text", text: "only part done" }],
            },
          },
        ]),
      ),
    );
    await executeChatAttempt(turn.attemptId, new AbortController());
    expect((await getChatTurn(userId, turn.id)).status).toBe("interrupted");
    expect((await getChatTurn(userId, turn.id)).text).toBe("only part done");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await db.usageLog.count({ where: { userId } })).toBe(0);
  }, 15_000);

  it("settles one hold after automatic continuation without creating another turn or attempt", async () => {
    const turn = await createChatTurn(userId, input());
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        stream([
          {
            type: "response.output_text.delta",
            item_id: "answer",
            delta: "preserved ",
          },
          {
            type: "response.failed",
            response: {
              status: "failed",
              error: {
                type: "upstream_error",
                message: "Unable to forward upstream stream",
              },
            },
          },
        ]),
      )
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetch);
    await executeChatAttempt(turn.attemptId, new AbortController());
    const view = await getChatTurn(userId, turn.id);
    expect(view).toMatchObject({
      status: "completed",
      text: "preserved answer",
      chargedCredits: 0.2,
      attemptId: turn.attemptId,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await db.chatAttempt.count({ where: { turnId: turn.id } })).toBe(1);
    expect(await db.usageLog.count({ where: { userId } })).toBe(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
    const entries = await db.creditEntry.findMany({ where: { userId } });
    expect(entries.map((entry) => entry.kind).sort()).toEqual([
      "chat.reserve",
      "chat.settle",
    ]);
    expect(
      entries.reduce((sum, entry) => sum + Number(entry.heldDelta), 0),
    ).toBe(0);
  }, 15_000);

  it("recovers a lost worker lease without another upstream request", async () => {
    const turn = await createChatTurn(userId, input());
    await db.chatAttempt.update({
      where: { id: turn.attemptId },
      data: {
        status: "running",
        rawText: "durable partial",
        heartbeatAt: new Date(Date.now() - 61_000),
      },
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await recoverStaleChatAttempts()).toBe(1);
    await executeChatAttempt(turn.attemptId, new AbortController());
    expect(fetch).not.toHaveBeenCalled();
    expect((await getChatTurn(userId, turn.id)).status).toBe("interrupted");
    expect((await getChatTurn(userId, turn.id)).text).toBe("durable partial");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
  });

  it("reconciles stale execution on snapshot reads even if no worker has restarted", async () => {
    const turn = await createChatTurn(userId, input());
    await db.chatAttempt.update({
      where: { id: turn.attemptId },
      data: {
        status: "running",
        rawText: "saved before process loss",
        heartbeatAt: new Date(Date.now() - 61_000),
      },
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const view = await getChatTurn(userId, turn.id);
    expect(view.status).toBe("interrupted");
    expect(view.text).toBe("saved before process loss");
    expect(view.billingState).toBe("released");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists published text before completion and ignores output arriving after cancellation", async () => {
    const turn = await createChatTurn(userId, input());
    let source: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                source = controller;
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "a", delta: "already received" })}\n\n`,
                  ),
                );
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    const execution = executeChatAttempt(turn.attemptId, new AbortController());
    await vi.waitFor(async () =>
      expect((await getChatTurn(userId, turn.id)).text).toBe(
        "already received",
      ),
    );
    expect((await getChatTurn(userId, turn.id)).status).toBe("running");
    await cancelChatTurn(userId, turn.id);
    source!.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", id: "a", content: [{ type: "output_text", text: "late completion" }] }] } })}\n\n`,
      ),
    );
    source!.close();
    await execution;
    const view = await getChatTurn(userId, turn.id);
    expect(view.status).toBe("cancelled");
    expect(view.text).toBe("already received");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
    expect(await db.usageLog.count({ where: { userId } })).toBe(0);
  });

  it("accepts one of two distinct concurrent submissions in one conversation", async () => {
    const attempts = await Promise.allSettled([
      createChatTurn(userId, input()),
      createChatTurn(userId, input()),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await db.chatAttempt.count({ where: { turn: { userId } } })).toBe(1);
    expect(
      await db.creditEntry.count({ where: { userId, kind: "chat.reserve" } }),
    ).toBe(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
  });

  it("replays a lost acknowledgement after completion without a second execution", async () => {
    const body = input();
    const accepted = await createChatTurn(userId, body);
    await finishChatAttempt({
      turnId: accepted.id,
      attemptId: accepted.attemptId,
      status: "completed",
      text: "committed before lost ACK",
    });
    const replay = await createChatTurn(userId, body);
    expect(replay.id).toBe(accepted.id);
    expect(replay.status).toBe("completed");
    expect(
      (await getChatTurnByRequest(userId, conversationId, body.clientRequestId))
        ?.id,
    ).toBe(accepted.id);
    expect(await db.chatTurn.count({ where: { userId } })).toBe(1);
    expect(
      await db.creditEntry.count({ where: { userId, kind: "chat.reserve" } }),
    ).toBe(1);
  });

  it("retains create/retry receipts and financial evidence after clearing content", async () => {
    const body = input();
    const first = await createChatTurn(userId, body);
    await cancelChatTurn(userId, first.id, first.attemptId);
    const key = randomUUID();
    const second = await retryChatTurn(userId, first.id, key, first.attemptId);
    await cancelChatTurn(userId, first.id, second.attemptId);
    await db.$transaction((tx) =>
      clearChatConversationContent(tx, conversationId, userId),
    );
    expect(await db.chatTurn.count({ where: { userId } })).toBe(0);
    expect(
      await db.chatRequestReceipt.count({
        where: { userId, contentClearedAt: { not: null } },
      }),
    ).toBe(2);
    expect(await db.creditEntry.count({ where: { userId } })).toBe(4);
    await expect(createChatTurn(userId, body)).rejects.toMatchObject({
      code: "CONTENT_CLEARED",
    });
    await expect(
      retryChatTurn(userId, first.id, key, first.attemptId),
    ).rejects.toMatchObject({ code: "CONTENT_CLEARED" });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
  });

  it("never lets a delayed cancel or retry target a later attempt", async () => {
    const first = await createChatTurn(userId, input());
    await cancelChatTurn(userId, first.id, first.attemptId);
    const second = await retryChatTurn(
      userId,
      first.id,
      randomUUID(),
      first.attemptId,
    );
    await expect(
      cancelChatTurn(userId, first.id, first.attemptId),
    ).rejects.toMatchObject({ code: "ATTEMPT_CHANGED" });
    await expect(
      retryChatTurn(userId, first.id, randomUUID(), first.attemptId),
    ).rejects.toMatchObject({ code: "ATTEMPT_CHANGED" });
    expect((await getChatTurn(userId, first.id)).attemptId).toBe(
      second.attemptId,
    );
    expect((await getChatTurn(userId, first.id)).status).toBe("queued");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
  });

  it("does not confuse a healthy queued backlog with an execution lease loss", async () => {
    const turn = await createChatTurn(userId, input());
    await db.chatAttempt.update({
      where: { id: turn.attemptId },
      data: { createdAt: new Date(Date.now() - 300_000) },
    });
    expect((await getChatTurn(userId, turn.id)).status).toBe("queued");
    await recoverStaleChatAttempts();
    expect((await getChatTurn(userId, turn.id)).status).toBe("queued");
    await db.chatAttempt.update({
      where: { id: turn.attemptId },
      data: { queueDeadline: new Date(Date.now() - 1_000) },
    });
    const expired = await getChatTurn(userId, turn.id);
    expect(expired.status).toBe("interrupted");
    expect(expired.error?.code).toBe("QUEUE_TIMEOUT");
  });

  it("rechecks a heartbeat committed behind an attempt row-lock barrier", async () => {
    const turn = await createChatTurn(userId, input());
    await db.chatAttempt.update({
      where: { id: turn.attemptId },
      data: {
        status: "running",
        heartbeatAt: new Date(Date.now() - 120_000),
        executionToken: "fresh-token",
      },
    });
    let locked!: () => void;
    let release!: () => void;
    const hasLock = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const heartbeat = db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ChatAttempt" WHERE "id" = ${turn.attemptId} FOR UPDATE`,
      );
      await tx.chatAttempt.update({
        where: { id: turn.attemptId },
        data: { heartbeatAt: new Date() },
      });
      locked();
      await barrier;
    });
    await hasLock;
    const recovery = finishChatAttempt({
      turnId: turn.id,
      attemptId: turn.attemptId,
      status: "interrupted",
      expectedStatus: "running",
      staleBefore: new Date(Date.now() - 60_000),
    });
    release();
    await heartbeat;
    expect(await recovery).toBe(false);
    expect((await getChatTurn(userId, turn.id)).status).toBe("running");
    expect(
      await db.creditEntry.count({ where: { userId, kind: "chat.release" } }),
    ).toBe(0);
  });

  it("rejects heartbeat and business events after recovery commits terminal", async () => {
    const turn = await createChatTurn(userId, input());
    await db.chatAttempt.update({
      where: { id: turn.attemptId },
      data: {
        status: "running",
        executionToken: "old-token",
        heartbeatAt: new Date(Date.now() - 120_000),
      },
    });
    expect(
      await finishChatAttempt({
        turnId: turn.id,
        attemptId: turn.attemptId,
        status: "interrupted",
        expectedStatus: "running",
        staleBefore: new Date(Date.now() - 60_000),
      }),
    ).toBe(true);
    expect(
      (
        await db.chatAttempt.updateMany({
          where: {
            id: turn.attemptId,
            status: "running",
            executionToken: "old-token",
          },
          data: { heartbeatAt: new Date() },
        })
      ).count,
    ).toBe(0);
    const count = await db.chatEvent.count({ where: { turnId: turn.id } });
    expect(
      await db.$transaction((tx) =>
        appendActiveChatEvent(tx, {
          turnId: turn.id,
          attemptId: turn.attemptId,
          executionToken: "old-token",
          type: "context.updated",
          payload: {},
        }),
      ),
    ).toBe(false);
    expect(await db.chatEvent.count({ where: { turnId: turn.id } })).toBe(
      count,
    );
    expect(
      await db.creditEntry.count({ where: { userId, kind: "chat.release" } }),
    ).toBe(1);
  });

  it("saves the current accumulator when malformed JSON arrives before the flush interval", async () => {
    const turn = await createChatTurn(userId, input());
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "a", delta: "unflushed final chunk" })}\n\ndata: {broken-json\n\n`,
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    await executeChatAttempt(turn.attemptId, new AbortController());
    const view = await getChatTurn(userId, turn.id);
    expect(view.text).toBe("unflushed final chunk");
    expect(["failed", "interrupted"]).toContain(view.status);
    expect(view.billingState).toBe("released");
  });

  it("deduplicates administrator adjustments and preserves their original receipt", async () => {
    const operation = {
      userId,
      actorId: "fixture-admin",
      operationKey: randomUUID(),
      amount: 0.2,
      note: "Synthetic adjustment",
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.$transaction((tx) => adjustCreditsIdempotently(tx, operation)),
      ),
    );
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.every((result) => result.user.credits === 10.2)).toBe(true);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10.2);
    expect(
      await db.creditEntry.count({ where: { userId, kind: "admin.adjust" } }),
    ).toBe(1);
    await expect(
      db.$transaction((tx) =>
        adjustCreditsIdempotently(tx, { ...operation, amount: 0.3 }),
      ),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("streams the configured Chat Completions model through the same durable lifecycle", async () => {
    const turn = await createChatTurn(userId, {
      ...input(),
      modelId: "default",
      reasoningEffort: undefined,
      webSearch: false,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      stream([
        { choices: [{ delta: { content: "hello " } }] },
        { choices: [{ delta: { content: "world" } }] },
        {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    await executeChatAttempt(turn.attemptId, new AbortController());
    const view = await getChatTurn(userId, turn.id);
    expect(view.text).toBe("hello world");
    expect(view.status).toBe("completed");
    expect(view.billingState).toBe("charged");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/chat/completions");
    expect(
      await db.creditEntry.count({ where: { userId, kind: "chat.settle" } }),
    ).toBe(1);
  });

  it("keeps the final parsed delta and sources on an abrupt reader rejection", async () => {
    const turn = await createChatTurn(userId, input());
    let pulls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (pulls++ === 0) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "a", delta: "saved reader rejection" })}\n\n`,
                    ),
                  );
                } else controller.error(new Error("Synthetic reader failure"));
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    await executeChatAttempt(turn.attemptId, new AbortController());
    const view = await getChatTurn(userId, turn.id);
    expect(view.text).toBe("saved reader rejection");
    expect(view.billingState).toBe("released");
    expect(
      await db.creditEntry.count({ where: { userId, kind: "chat.release" } }),
    ).toBe(1);
  });

  it("keeps the success settlement after content deletion and refuses its old submission", async () => {
    const body = input();
    const turn = await createChatTurn(userId, body);
    await finishChatAttempt({
      turnId: turn.id,
      attemptId: turn.attemptId,
      status: "completed",
      text: "done",
    });
    await db.$transaction((tx) =>
      clearChatConversationContent(tx, conversationId, userId),
    );
    expect(await db.creditEntry.count({ where: { userId } })).toBe(2);
    expect(
      await db.usageLog.count({
        where: { userId, action: "conversation.chat" },
      }),
    ).toBe(1);
    await expect(createChatTurn(userId, body)).rejects.toMatchObject({
      code: "CONTENT_CLEARED",
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(9.8);
  });

  it("validates private references before accepting a reservation", async () => {
    vi.mocked(resolveChatReferences).mockRejectedValueOnce(
      new Error("REFERENCE_NOT_FOUND"),
    );
    await expect(
      createChatTurn(userId, {
        ...input(),
        modelId: "default",
        webSearch: false,
        references: [{ kind: "upload", key: "uploads/another-user/image.png" }],
      }),
    ).rejects.toMatchObject({ code: "REFERENCE_NOT_FOUND" });
    expect(await db.chatRequestReceipt.count({ where: { userId } })).toBe(0);
    expect(await db.creditEntry.count({ where: { userId } })).toBe(0);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
  });

  it("gives concurrent completion/cancellation exactly one financial terminal", async () => {
    const turn = await createChatTurn(userId, input());
    await Promise.all([
      finishChatAttempt({
        turnId: turn.id,
        attemptId: turn.attemptId,
        status: "completed",
        text: "valid completion",
      }),
      cancelChatTurn(userId, turn.id, turn.attemptId),
    ]);
    const view = await getChatTurn(userId, turn.id);
    const charged = view.status === "completed";
    expect(["completed", "cancelled"]).toContain(view.status);
    expect(
      await db.creditEntry.count({
        where: { operationKey: `close:${turn.attemptId}` },
      }),
    ).toBe(1);
    expect(
      await db.usageLog.count({
        where: { userId, action: "conversation.chat" },
      }),
    ).toBe(charged ? 1 : 0);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(charged ? 9.8 : 10);
  });

  it("keeps an administrator delta when settlement races the adjustment", async () => {
    const turn = await createChatTurn(userId, input());
    await Promise.all([
      finishChatAttempt({
        turnId: turn.id,
        attemptId: turn.attemptId,
        status: "completed",
        text: "complete",
      }),
      db.$transaction((tx) =>
        adjustCreditsIdempotently(tx, {
          userId,
          actorId: "fixture-admin",
          operationKey: randomUUID(),
          amount: 0.3,
        }),
      ),
    ]);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10.1);
    expect(await db.creditEntry.count({ where: { userId } })).toBe(3);
    expect(await db.usageLog.count({ where: { userId } })).toBe(2);
  });

  async function syntheticContextHistory() {
    const start = Date.now() - 60_000;
    await db.conversationMessage.createMany({
      data: Array.from({ length: 24 }, (_, index) => ({
        conversationId,
        role: index % 2 ? ("ASSISTANT" as const) : ("USER" as const),
        content: `Synthetic turn ${Math.floor(index / 2)}: ${"Preserve the street width and remember the orange marker. ".repeat(40)}`,
        createdAt: new Date(start + index),
      })),
    });
  }

  it("persists and reuses PostgreSQL context snapshots without Redis or repeat summarization", async () => {
    await syntheticContextHistory();
    const actual =
      await vi.importActual<typeof import("@/lib/chat-context")>(
        "@/lib/chat-context",
      );
    const fetch = vi.fn(async () => success());
    vi.stubGlobal("fetch", fetch);
    const contextInput = {
      userId,
      conversationId,
      modelId: SOL_MODEL_ID,
      latestMessage: {
        role: "user" as const,
        content: "Remember the constraints",
      },
    };
    const compacted = await actual.prepareChatContext({
      ...contextInput,
      forceCompact: true,
    });
    expect(compacted.manifest.snapshotId).toBeTruthy();
    expect(await db.contextSnapshot.count({ where: { conversationId } })).toBe(
      1,
    );
    const calls = fetch.mock.calls.length;
    const reused = await actual.prepareChatContext(contextInput);
    expect(reused.manifest.snapshotId).toBe(compacted.manifest.snapshotId);
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
    ).toBe(10);
    expect(reused.messages).toHaveLength(10);
  });

  it("rejects a summary generated across a real history-edit transaction", async () => {
    await syntheticContextHistory();
    const actual =
      await vi.importActual<typeof import("@/lib/chat-context")>(
        "@/lib/chat-context",
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE`,
          );
          const first = await tx.conversationMessage.findFirstOrThrow({
            where: { conversationId },
            orderBy: { createdAt: "asc" },
          });
          await tx.conversationMessage.update({
            where: { id: first.id },
            data: { content: "Edited while summary was running" },
          });
          await tx.conversation.update({
            where: { id: conversationId },
            data: { contextRevision: { increment: 1 } },
          });
        });
        return success();
      }),
    );
    await expect(
      actual.prepareChatContext({
        userId,
        conversationId,
        modelId: SOL_MODEL_ID,
        forceCompact: true,
        latestMessage: { role: "user", content: "Current question" },
      }),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_CHANGED" });
    expect(await db.contextSnapshot.count({ where: { conversationId } })).toBe(
      0,
    );
  });

  it("allows only one of two workers to execute the same queued attempt", async () => {
    const turn = await createChatTurn(userId, input());
    const fetch = vi.fn(async () => success());
    vi.stubGlobal("fetch", fetch);
    await Promise.all([
      executeChatAttempt(turn.attemptId, new AbortController()),
      executeChatAttempt(turn.attemptId, new AbortController()),
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect((await getChatTurn(userId, turn.id)).status).toBe("completed");
    expect(
      await db.creditEntry.count({
        where: { operationKey: `close:${turn.attemptId}` },
      }),
    ).toBe(1);
  });

  it("closes new admission while preserving accepted execution and request recovery", async () => {
    const original = await db.systemConfig.findUniqueOrThrow({
      where: { key: "chat.runtime" },
    });
    const body = input();
    const turn = await createChatTurn(userId, body);
    try {
      await setChatRuntimeConfig({ enabled: false });
      await expect(createChatTurn(userId, input())).rejects.toMatchObject({
        code: "CHAT_RUNTIME_PAUSED",
      });
      expect((await createChatTurn(userId, body)).id).toBe(turn.id);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => success()),
      );
      await executeChatAttempt(turn.attemptId, new AbortController());
      expect((await getChatTurn(userId, turn.id)).status).toBe("completed");
      expect(
        await db.creditEntry.count({ where: { userId, kind: "chat.reserve" } }),
      ).toBe(1);
    } finally {
      await db.systemConfig.update({
        where: { key: "chat.runtime" },
        data: { value: original.value as Prisma.InputJsonValue },
      });
    }
  });
});
