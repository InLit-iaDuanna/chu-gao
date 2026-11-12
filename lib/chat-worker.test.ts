// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  raw: vi.fn(),
  findAttempt: vi.fn(),
  findQueued: vi.fn(),
  updateAttempt: vi.fn(),
  updateTurn: vi.fn(),
  updateMessage: vi.fn(),
  transaction: vi.fn(),
  appendActive: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  context: vi.fn(),
  profile: vi.fn(),
  touch: vi.fn(),
  remove: vi.fn(),
  callUsage: vi.fn(),
  callFinish: vi.fn(),
  submitImage: vi.fn(),
  active: true,
}));
vi.mock("@/lib/db", () => ({
  db: {
    $executeRaw: mocks.claim,
    $queryRaw: mocks.raw,
    $transaction: mocks.transaction,
    chatAttempt: {
      findUniqueOrThrow: mocks.findAttempt,
      findMany: mocks.findQueued,
      updateMany: mocks.updateAttempt,
      update: mocks.updateAttempt,
    },
    chatTurn: { updateMany: mocks.updateTurn },
  },
}));
vi.mock("@/lib/chat-turns", () => ({
  appendActiveChatEvent: mocks.appendActive,
  appendChatEvent: mocks.append,
  finishChatAttempt: mocks.finish,
}));
vi.mock("@/lib/chat-context", () => ({ prepareChatContext: mocks.context }));
vi.mock("@/lib/chat-profiles", () => ({ getChatProfile: mocks.profile }));
vi.mock("@/lib/model-call-log", () => ({
  startModelCall: async () => ({
    response: vi.fn(),
    usage: mocks.callUsage,
    finish: mocks.callFinish,
  }),
}));
vi.mock("@/lib/chat-references", () => ({
  resolveChatReferences: async () => [],
}));
vi.mock("@/lib/chat-image-tool", () => ({
  submitChatImageTool: mocks.submitImage,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/chat-runtime-health", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-runtime-health")>()),
  touchChatWorkerHeartbeat: mocks.touch,
  removeChatWorkerHeartbeat: mocks.remove,
}));

import {
  executeChatAttempt,
  recoverStaleChatAttempts,
  startChatWorker,
} from "@/lib/chat-worker";
import { OPUS_MODEL_ID } from "@/lib/chat-model-options";
import { chatInputTokenUpperBound } from "@/lib/chat-token-billing";
import { chatCompletionsRequestBody } from "@/lib/chat-upstream";
import { CHAT_IMAGE_TOOL } from "@/lib/chat-image-tool-definition";

const sseResponse = (text: string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "fixture-request",
      },
    },
  );
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const delta = {
  type: "response.output_text.delta",
  item_id: "answer",
  delta: "last parsed content",
};

describe("chat worker boundaries", () => {
  const tx = {
    $queryRaw: mocks.raw,
    chatAttempt: {
      updateMany: mocks.updateAttempt,
      update: mocks.updateAttempt,
    },
    conversationMessage: { updateMany: mocks.updateMessage },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
    mocks.active = true;
    mocks.claim.mockResolvedValue(1);
    mocks.raw.mockResolvedValue([{ now: new Date("2026-10-18T00:00:00Z") }]);
    mocks.updateAttempt.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation((operation) => operation(tx));
    mocks.appendActive.mockImplementation(async () => mocks.active);
    mocks.finish.mockResolvedValue(true);
    mocks.submitImage.mockResolvedValue({
      ok: true,
      generationId: "generation-image-tool",
      status: "PENDING",
      estimatedCredits: 6,
      modelId: "gpt-image-2",
    });
    mocks.findQueued.mockResolvedValue([]);
    mocks.touch.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.profile.mockResolvedValue({
      enabled: true,
      apiKey: "fixture-key",
      baseUrl: "https://upstream.invalid",
      model: "model-a",
    });
    mocks.context.mockResolvedValue({
      messages: [{ role: "user", content: "synthetic" }],
      status: { estimatedTokens: 10 },
      snapshotId: "snapshot-a",
      manifest: { messageIds: ["message-a"] },
    });
    mocks.findAttempt.mockResolvedValue({
      id: "attempt-a",
      createdAt: new Date("2026-10-17T23:00:00Z"),
      startedAt: new Date(),
      turn: {
        id: "turn-a",
        activeAttemptId: "attempt-a",
        activeConversationId: "conversation-a",
        conversationId: "conversation-a",
        userId: "user-a",
        modelId: "default",
        input: {
          content: "synthetic",
          referenceImageKeys: [],
          sourceImageIds: [],
        },
        configSnapshot: {
          model: "model-a",
          baseUrl: "https://upstream.invalid",
          transport: "responses_sse",
          instructions: "synthetic",
          effort: "low",
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          event(delta) +
            event({
              type: "response.completed",
              response: { status: "completed" },
            }),
        ),
      ),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const opus = async () => {
    const attempt = await mocks.findAttempt();
    attempt.turn.modelId = OPUS_MODEL_ID;
    Object.assign(attempt.turn.configSnapshot, {
      model: OPUS_MODEL_ID,
      effort: "xhigh",
      transport: "chat_completions_sse",
      tokenPricing: {
        version: 1,
        maxInputTokens: 4096,
        maxOutputTokens: 64,
        pricing: {
          type: "per_million_tokens",
          input: 100,
          output: 500,
          cacheRead: 5,
          cacheCreation: 60,
        },
      },
    });
    mocks.findAttempt.mockResolvedValue(attempt);
    mocks.profile.mockResolvedValue({
      enabled: true,
      apiKey: "fixture-key",
      baseUrl: "https://upstream.invalid",
      model: OPUS_MODEL_ID,
    });
  };

  it("retains final Chat Completions usage after finish_reason and stops at DONE on an open stream", async () => {
    await opus();
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
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    event({
                      choices: [
                        { delta: { content: "answer" }, finish_reason: null },
                      ],
                    }) +
                      event({
                        choices: [{ delta: {}, finish_reason: "stop" }],
                      }) +
                      event({ choices: [], usage }) +
                      "data: [DONE]\n\n",
                  ),
                );
              },
              cancel,
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      status: "completed",
      text: "answer",
      usage,
    });
    expect(mocks.callUsage).toHaveBeenCalledExactlyOnceWith({
      ...usage,
      input_tokens: 270,
      output_tokens: 1,
      uncached_input_tokens: 8,
      cache_read_input_tokens: 35,
      cache_creation_input_tokens: 227,
      input_tokens_details: {
        cached_tokens: 35,
        cached_creation_tokens: 227,
        cache_write_tokens: 227,
      },
    });
    const request = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string,
    );
    expect(request).toMatchObject({
      model: OPUS_MODEL_ID,
      reasoning_effort: "xhigh",
      max_tokens: 64,
      stream_options: { include_usage: true },
    });
    expect(mocks.context.mock.calls[0][0]).not.toHaveProperty("skipCompaction");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("executes one image tool call and resumes the same chat turn with its result", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          sseResponse(
            event({
              type: "response.output_item.added",
              output_index: 0,
              item: {
                id: "function-item",
                type: "function_call",
                call_id: "call-image",
                name: "generate_image",
              },
            }) +
              event({
                type: "response.function_call_arguments.done",
                output_index: 0,
                item_id: "function-item",
                call_id: "call-image",
                arguments: '{"prompt":"a paper bird"}',
              }) +
              event({
                type: "response.completed",
                response: {
                  status: "completed",
                  output: [
                    {
                      id: "function-item",
                      type: "function_call",
                      call_id: "call-image",
                      name: "generate_image",
                      arguments: '{"prompt":"a paper bird"}',
                    },
                  ],
                },
              }),
          ),
        )
        .mockResolvedValueOnce(
          sseResponse(
            event({
              type: "response.output_text.delta",
              item_id: "answer",
              delta: "图片任务已提交。",
            }) +
              event({
                type: "response.completed",
                response: { status: "completed" },
              }),
          ),
        ),
    );
    mocks.updateMessage.mockResolvedValue({ count: 1 });

    await executeChatAttempt("attempt-a", new AbortController());

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.submitImage).toHaveBeenCalledWith(
      '{"prompt":"a paper bird"}',
      expect.objectContaining({
        conversationId: "conversation-a",
        callId: "call-image",
      }),
    );
    expect(mocks.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { generationId: "generation-image-tool" },
      }),
    );
    expect(
      mocks.appendActive.mock.calls.some(
        ([, input]) =>
          input.type === "generation.created" &&
          input.payload.generationId === "generation-image-tool",
      ),
    ).toBe(true);
    expect(mocks.finish.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "completed",
      text: "图片任务已提交。",
    });
    const resumed = JSON.parse(
      vi.mocked(fetch).mock.calls[1][1]!.body as string,
    );
    expect(resumed.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call",
          call_id: "call-image",
        }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call-image",
        }),
      ]),
    );
  });

  const imageToolFrames = (complete = true, withUsage = true) =>
    event({
      choices: [
        {
          delta: {
            content: "先提交图片。",
            tool_calls: [
              {
                index: 0,
                id: "image-call",
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: '{"prompt":"街景  保留空格"}',
                },
              },
            ],
          },
          finish_reason: complete ? "tool_calls" : null,
        },
      ],
    }) +
    (withUsage
      ? event({
          choices: [],
          usage: { prompt_tokens: 270, completion_tokens: 12 },
        })
      : "") +
    "data: [DONE]\n\n";

  const imageOpus = async () => {
    await opus();
    const attempt = await mocks.findAttempt();
    const firstRequest = chatCompletionsRequestBody(
      OPUS_MODEL_ID,
      [{ role: "user", content: "synthetic" }],
      "synthetic",
      {
        effort: "xhigh",
        maxOutputTokens: 64,
        includeUsage: true,
        tools: [CHAT_IMAGE_TOOL],
      },
    );
    const firstBound = chatInputTokenUpperBound(firstRequest);
    Object.assign(attempt.turn.configSnapshot.tokenPricing, {
      maxInputTokens: firstBound * 2 + 32_768,
      maxOutputTokens: 128,
    });
    Object.assign(attempt.turn.configSnapshot, {
      tokenRequestLimits: {
        maxInputTokens: 262_144,
        maxOutputTokens: 64,
        maxRequests: 2,
      },
    });
    mocks.updateMessage.mockResolvedValue({ count: 1 });
    return firstBound;
  };

  it("reserves and bills both Opus tool segments, preserves prose, and sends the actual tool result without another tool", async () => {
    const originalBound = await imageOpus();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sseResponse(imageToolFrames()))
        .mockResolvedValueOnce(
          sseResponse(
            event({
              choices: [
                { delta: { content: "任务已提交。" }, finish_reason: "stop" },
              ],
            }) +
              event({
                choices: [],
                usage: { prompt_tokens: 300, completion_tokens: 8 },
              }) +
              "data: [DONE]\n\n",
          ),
        ),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.submitImage).toHaveBeenCalledTimes(1);
    const second = JSON.parse(
      vi.mocked(fetch).mock.calls[1][1]!.body as string,
    );
    const withoutTools = { ...second };
    delete withoutTools.tools;
    delete withoutTools.tool_choice;
    const first = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    delete first.tools;
    delete first.tool_choice;
    // This is the exact condition that rejected every original tool continuation.
    expect(chatInputTokenUpperBound(withoutTools)).toBeGreaterThan(
      chatInputTokenUpperBound(first),
    );
    expect(chatInputTokenUpperBound(second)).toBeLessThan(
      originalBound + 32_768,
    );
    expect(second.max_tokens).toBe(64);
    expect(second.tools).toBeUndefined();
    expect(second.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "先提交图片。" }),
        expect.objectContaining({
          role: "tool",
          tool_call_id: "image-call",
          content: expect.stringContaining("generation-image-tool"),
        }),
      ]),
    );
    expect(mocks.finish.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "completed",
      text: "先提交图片。任务已提交。",
      usage: {
        prompt_tokens: 570,
        completion_tokens: 20,
        usage_availability: "reported",
        usage_segments: [
          { prompt_tokens: 270, completion_tokens: 12 },
          { prompt_tokens: 300, completion_tokens: 8 },
        ],
      },
    });
  });

  it("never submits an image from a truncated tool call without its completion marker", async () => {
    await imageOpus();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(imageToolFrames(false))),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(mocks.submitImage).not.toHaveBeenCalled();
    expect(mocks.finish.mock.calls.at(-1)?.[0].status).toBe("interrupted");
  });

  it("keeps image submission separate when the following prose request fails, without claiming the round was free", async () => {
    await imageOpus();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sseResponse(imageToolFrames()))
        .mockRejectedValueOnce(new Error("fetch failed")),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(mocks.submitImage).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "interrupted",
      text: "先提交图片。",
      usage: { usage_availability: "unknown" },
      error: { publicMessage: expect.stringContaining("文字回复未收费") },
    });
    expect(
      mocks.finish.mock.calls.at(-1)?.[0].error.publicMessage,
    ).not.toContain("本轮未收费");
  });

  it("does not drop an unknown first segment from token settlement", async () => {
    await imageOpus();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sseResponse(imageToolFrames(true, false)))
        .mockResolvedValueOnce(
          sseResponse(
            event({
              choices: [
                { delta: { content: "完成回复" }, finish_reason: "stop" },
              ],
            }) +
              event({
                choices: [],
                usage: { prompt_tokens: 300, completion_tokens: 8 },
              }) +
              "data: [DONE]\n\n",
          ),
        ),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(mocks.finish.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "completed",
      usage: {
        usage_availability: "unknown",
        usage_segments: [null, { prompt_tokens: 300, completion_tokens: 8 }],
      },
    });
  });

  it("retries only prose when a previous image submission was retained", async () => {
    await imageOpus();
    const attempt = await mocks.findAttempt();
    attempt.parts = {
      imageContinuation: {
        generationId: "existing-image",
        status: "SUCCEEDED",
        prompt: "original",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          event({
            choices: [
              { delta: { content: "这是上一张图片。" }, finish_reason: "stop" },
            ],
          }) + "data: [DONE]\n\n",
        ),
      ),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages)).toContain("existing-image");
    expect(mocks.submitImage).not.toHaveBeenCalled();
    expect(mocks.finish.mock.calls.at(-1)?.[0].status).toBe("completed");
  });

  it("keeps an explicit completion when the subsequent usage tail disconnects", async () => {
    await opus();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    event({
                      choices: [
                        {
                          delta: { content: "完整回复" },
                          finish_reason: "stop",
                        },
                      ],
                    }),
                  ),
                );
              },
              pull() {
                throw new Error("terminated");
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(mocks.finish.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "completed",
      text: "完整回复",
      usage: null,
    });
  });

  it("leaves missing final usage explicit and never synthesizes token counts", async () => {
    await opus();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          event({
            choices: [
              {
                delta: { content: "answer" },
                finish_reason: "stop",
              },
            ],
          }) + "data: [DONE]\n\n",
        ),
      ),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      status: "completed",
      usage: null,
    });
    expect(mocks.callUsage).toHaveBeenCalledWith({});
  });

  it("does not automatically issue an extra paid request after an Opus stream interruption", async () => {
    await opus();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(event({ choices: [{ delta: { content: "partial" } }] })),
      ),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      status: "interrupted",
      text: "partial",
    });
  });

  it("checks the exact prepared request against its accepted bound before upstream execution", async () => {
    await opus();
    mocks.context.mockResolvedValue({
      messages: [{ role: "user", content: "a".repeat(5000) }],
      status: {},
      manifest: {},
    });
    await executeChatAttempt("attempt-a", new AbortController());
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      status: "interrupted",
      error: { code: "token_pricing_input_bound_exceeded" },
    });
  });

  it("saves the complete accumulator after a bad frame inside the flush interval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(event(delta) + "data: {broken}\n\n")),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      status: "interrupted",
      text: "last parsed content",
      parts: {
        version: 3,
        parts: [{ itemId: "answer", text: "last parsed content" }],
      },
      sources: [],
      usage: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const checkpoints = mocks.updateAttempt.mock.calls
      .map(([input]) => input.data)
      .filter((data) => data.parts);
    expect(checkpoints.at(-1)).toMatchObject({
      rawText: "last parsed content",
      timings: {
        first_text_received_at: expect.any(String),
        first_text_committed_at: expect.any(String),
      },
    });
  });

  it("retains the last parsed delta on reader rejection", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (reads++ === 0)
                  controller.enqueue(new TextEncoder().encode(event(delta)));
                else controller.error(new Error("fixture reader rejected"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
    );
    await executeChatAttempt("attempt-a", new AbortController());
    expect(mocks.finish.mock.calls[0][0].text).toBe("last parsed content");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("continues a forwarding failure on the same attempt and finalizes once", async () => {
    const forwardFailure = {
      type: "response.failed",
      response: {
        status: "failed",
        error: {
          type: "upstream_error",
          message: "Unable to forward upstream stream",
        },
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(event(delta) + event(forwardFailure)))
      .mockResolvedValueOnce(
        sseResponse(
          event({ ...delta, delta: " and the rest" }) +
            event({
              type: "response.completed",
              response: {
                status: "completed",
                usage: {
                  input_tokens: 1600,
                  input_tokens_details: { cached_tokens: 1200 },
                },
              },
            }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const running = executeChatAttempt("attempt-a", new AbortController());
    await vi.advanceTimersByTimeAsync(2500);
    await running;
    expect(fetch).toHaveBeenCalledTimes(2);
    const resumed = JSON.parse(fetch.mock.calls[1][1].body);
    expect(resumed.input.at(-2)).toMatchObject({
      role: "assistant",
      content: [{ text: "last parsed content" }],
    });
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      status: "completed",
      text: "last parsed content and the rest",
      parts: { recovery: { used: 1 } },
      usage: { input_tokens_details: { cached_tokens: 1200 } },
    });
    expect(
      mocks.append.mock.calls.some(
        ([, , , type, payload]) =>
          type === "activity.updated" && payload.activity === "retrying",
      ),
    ).toBe(true);
  });

  it("limits EOF recovery to two retries and retains partial output when all streams fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(event(delta))),
    );
    const running = executeChatAttempt("attempt-a", new AbortController());
    await vi.advanceTimersByTimeAsync(7000);
    await running;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      status: "interrupted",
      text: "last parsed content",
      parts: { recovery: { used: 2 } },
    });
  });

  it("stops during retry backoff without another upstream call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(event(delta))),
    );
    const abort = new AbortController();
    const running = executeChatAttempt("attempt-a", abort);
    await vi.advanceTimersByTimeAsync(1000);
    abort.abort(new Error("USER_CANCEL"));
    await running;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      status: "interrupted",
      text: "last parsed content",
    });
  });

  it("retries catch finalization without replaying the upstream request", async () => {
    mocks.finish.mockRejectedValueOnce(new Error("fixture transaction retry"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(event(delta) + "data: {broken}\n\n")),
    );
    const running = executeChatAttempt("attempt-a", new AbortController());
    await vi.advanceTimersByTimeAsync(300);
    await running;
    expect(mocks.finish).toHaveBeenCalledTimes(2);
    expect(mocks.finish.mock.calls[1][0]).toMatchObject({
      text: "last parsed content",
      status: "interrupted",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("checkpoints annotation-only revisions even when text and source URLs are unchanged", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const ready = Promise.withResolvers<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(value) {
                controller = value;
                ready.resolve();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
    );
    const running = executeChatAttempt("attempt-a", new AbortController());
    await ready.promise;
    const annotation = {
      type: "response.output_text.annotation.added",
      item_id: "answer",
      annotation_index: 0,
      annotation: {
        type: "url_citation",
        url: "https://example.org",
        start_index: 0,
        end_index: 4,
      },
    };
    controller.enqueue(
      new TextEncoder().encode(event(delta) + event(annotation)),
    );
    await vi.advanceTimersByTimeAsync(45);
    const before = mocks.updateAttempt.mock.calls.filter(
      ([input]) => input.data.parts,
    ).length;
    controller.enqueue(
      new TextEncoder().encode(
        event({
          ...annotation,
          annotation: { ...annotation.annotation, end_index: 6 },
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(45);
    const checkpoints = mocks.updateAttempt.mock.calls.filter(
      ([input]) => input.data.parts,
    );
    expect(checkpoints.length).toBeGreaterThan(before);
    expect(
      checkpoints.at(-1)![0].data.parts.parts[0].annotations[0].end_index,
    ).toBe(6);
    controller.enqueue(
      new TextEncoder().encode(
        event({
          type: "response.completed",
          response: { status: "completed" },
        }),
      ),
    );
    controller.close();
    await running;
  });

  it("uses DB-clock CAS and does not issue an upstream request when claim loses", async () => {
    mocks.claim.mockResolvedValue(0);
    await executeChatAttempt("attempt-a", new AbortController());
    const claim = mocks.claim.mock.calls[0][0];
    expect(claim.sql).toContain("\"status\" = 'queued'");
    expect(claim.sql).toContain("clock_timestamp()");
    expect(claim.sql).toContain('"protocolVersion" IN');
    expect(claim.sql).toContain('"queueDeadline" IS NULL');
    expect(
      claim.values.filter((value: unknown) => value instanceof Date),
    ).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("keeps executing accepted tasks when a model enabled flag is rolled back", async () => {
    mocks.profile.mockResolvedValue({
      enabled: false,
      apiKey: "fixture-key",
      baseUrl: "https://upstream.invalid",
      model: "model-a",
    });
    await executeChatAttempt("attempt-a", new AbortController());
    expect(fetch).toHaveBeenCalledTimes(1);
    const contextWrite = mocks.updateAttempt.mock.calls
      .map(([input]) => input.data)
      .find((data) => data.requestHash);
    expect(contextWrite).toMatchObject({
      contextSnapshotId: "snapshot-a",
      contextManifest: {
        messageIds: ["message-a"],
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mocks.context.mock.calls[0][0]).toMatchObject({
      currentTurnId: "turn-a",
      instructions: "synthetic",
      buildRequest: expect.any(Function),
    });
  });

  it("guards delayed context and every checkpoint after cancellation", async () => {
    let release: (value: unknown) => void = () => undefined;
    const entered = Promise.withResolvers<void>();
    mocks.context.mockImplementation(() => {
      entered.resolve();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const running = executeChatAttempt("attempt-a", new AbortController());
    await entered.promise;
    expect(
      mocks.updateAttempt.mock.calls.some(
        ([input]) => input.data.activity === "context",
      ),
    ).toBe(true);
    mocks.active = false;
    const writeCount = mocks.updateAttempt.mock.calls.length;
    release({ messages: [], status: { estimatedTokens: 0 } });
    await running;
    expect(mocks.updateAttempt.mock.calls.slice(writeCount)).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      mocks.appendActive.mock.calls.filter(
        ([, input]) => input.type === "context.updated",
      ),
    ).toHaveLength(0);
  });

  it("recovers explicit queue deadlines separately and leaves unbounded queues alone", async () => {
    const now = new Date("2026-10-18T00:00:00Z");
    mocks.raw.mockResolvedValueOnce([{ now }]).mockResolvedValueOnce([
      { id: "queued-a", turnId: "turn-q", status: "queued" },
      { id: "running-a", turnId: "turn-r", status: "running" },
    ]);
    expect(await recoverStaleChatAttempts()).toBe(2);
    const select = mocks.raw.mock.calls[1][0];
    expect(select.sql).toContain('"queueDeadline" IS NOT NULL');
    expect(select.sql).not.toContain('"createdAt" <');
    expect(mocks.finish.mock.calls[0][0]).toMatchObject({
      expectedStatus: "queued",
      queueExpiredBefore: now,
      error: { code: "QUEUE_TIMEOUT" },
    });
    expect(mocks.finish.mock.calls[0][0].staleBefore).toBeUndefined();
    expect(mocks.finish.mock.calls[1][0].staleBefore).toEqual(
      new Date(now.getTime() - 60_000),
    );
  });

  it("stops within its bound while Redis/pump is stuck and removes only its own heartbeat", async () => {
    mocks.touch.mockImplementation(() => new Promise(() => undefined));
    const stop = startChatWorker({
      instanceId: "instance-a",
      shutdownTimeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(1);
    const stopped = stop();
    await vi.advanceTimersByTimeAsync(51);
    await stopped;
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("instance-a");
    expect(mocks.findQueued.mock.calls[0][0].where.protocolVersion.in).toEqual([
      2,
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.findQueued).toHaveBeenCalledTimes(1);
    await stop();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
