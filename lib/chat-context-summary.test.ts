import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/chat-profiles", () => ({ getChatProfile: mocks.profile }));

import {
  createContextSummarizer,
  estimateTextTokens,
  MAX_SUMMARY_TOKENS,
} from "@/lib/chat-context-summary";

function sse(events: unknown[], chunkSize = 17) {
  const data = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""),
  );
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < data.length; offset += chunkSize)
          controller.enqueue(data.slice(offset, offset + chunkSize));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}
const completed = (text = "Confirmed decisions.") => ({
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
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.profile.mockImplementation(async (modelId: string) => ({
    enabled: true,
    apiKey: "mock-secret",
    baseUrl: "https://summary.invalid/v1",
    model: modelId,
    transport: modelId === "default" ? "chat_completions_sse" : "responses_sse",
  }));
  mocks.fetch.mockImplementation(async () => sse([completed()]));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("summary transport follows the existing profile", () => {
  it.each(["gpt-6.1-sol", "gpt-5.6-luna"])(
    "uses native Responses SSE for %s, with low effort and no unverified tool_choice",
    async (modelId) => {
      const summarize = await createContextSummarizer(modelId);
      expect(
        await summarize(
          [{ role: "user", content: "Retain this constraint" }],
          "Earlier summary",
        ),
      ).toBe("Confirmed decisions.");
      expect(mocks.profile).toHaveBeenCalledWith(modelId);
      const [url, init] = mocks.fetch.mock.calls[0];
      expect(url).toBe("https://summary.invalid/v1/responses");
      expect(init.headers).toMatchObject({
        Accept: "text/event-stream",
        "Accept-Encoding": "identity",
      });
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        model: modelId,
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 2048,
      });
      expect(body).not.toHaveProperty("tools");
      expect(body).not.toHaveProperty("tool_choice");
      expect(JSON.parse(body.input[0].content[0].text)).toMatchObject({
        previousSummary: "Earlier summary",
      });
    },
  );

  it("uses chat-completions SSE for the default profile and requires a stop finish", async () => {
    mocks.fetch.mockResolvedValue(
      sse([
        { choices: [{ delta: { content: "Earlier " }, finish_reason: null }] },
        {
          choices: [{ delta: { content: "decisions." }, finish_reason: null }],
        },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]),
    );
    expect(await (await createContextSummarizer("default"))([], null)).toBe(
      "Earlier decisions.",
    );
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://summary.invalid/v1/chat/completions",
    );
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
      stream: true,
      thinking: { type: "disabled" },
      max_tokens: 2048,
    });
  });

  it("uses the authoritative completed response instead of an earlier delta", async () => {
    mocks.fetch.mockResolvedValue(
      sse(
        [
          {
            type: "response.output_text.delta",
            delta: "Incorrect partial fact",
          },
          completed("Confirmed final fact"),
        ],
        1,
      ),
    );
    expect(await (await createContextSummarizer("gpt-6.1-sol"))([], null)).toBe(
      "Confirmed final fact",
    );
  });

  it.each([
    [{ type: "response.output_text.delta", delta: "Partial only" }],
    [{ type: "response.failed", response: { status: "failed" } }],
    [{ type: "response.incomplete", response: { status: "incomplete" } }],
    [completed("")],
    [completed("中".repeat(2_000))],
    [
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            { type: "message", content: [{ type: "refusal", refusal: "No" }] },
          ],
        },
      },
    ],
    [
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [{ type: "function_call", name: "tool" }],
        },
      },
    ],
  ])(
    "rejects failed, refused, truncated or malformed SSE summaries",
    async (events) => {
      // Vitest treats a nested array table as positional arguments.
      mocks.fetch.mockResolvedValue(
        sse(Array.isArray(events) ? events : [events]),
      );
      await expect(
        (await createContextSummarizer("gpt-6.1-sol"))([], null),
      ).rejects.toMatchObject({ code: "CHAT_CONTEXT_SUMMARY_FAILED" });
    },
  );

  it("rejects a JSON-only response to a native SSE request", async () => {
    mocks.fetch.mockResolvedValue(Response.json(completed().response));
    await expect(
      (await createContextSummarizer("gpt-6.1-sol"))([], null),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_SUMMARY_FAILED" });
  });

  it("rejects malformed JSON SSE without exposing provider details", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("data: {private malformed\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    await expect(
      (await createContextSummarizer("gpt-6.1-sol"))([], null),
    ).rejects.toMatchObject({
      code: "CHAT_CONTEXT_SUMMARY_FAILED",
      message: expect.not.stringContaining("private"),
    });
  });

  it("bounds summary input and output independently of the dialogue budget", async () => {
    expect(estimateTextTokens("中".repeat(2_000))).toBeGreaterThan(
      MAX_SUMMARY_TOKENS,
    );
    await expect(
      (await createContextSummarizer("gpt-6.1-sol"))(
        [{ role: "user", content: "中".repeat(10_000) }],
        null,
      ),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_MESSAGE_TOO_LARGE" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("maps timeout and cancellation to explicit public errors", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    mocks.fetch.mockRejectedValue(new Error("private provider timeout"));
    await expect(
      (await createContextSummarizer("gpt-6.1-sol"))([], null),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_TIMEOUT", statusCode: 504 });
    expect(timeout).toHaveBeenCalledWith(150_000);
    expect(timeout).toHaveBeenCalledWith(90_000);
    await expect(
      createContextSummarizer("gpt-6.1-sol", controller.signal),
    ).rejects.toMatchObject({ code: "CHAT_CONTEXT_CANCELED" });
  });
});
