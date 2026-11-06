import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatCompatibleResearchResponse, researchModelCall } from "./gateway";
import { responseText } from "./model-protocol";
import { finishResearchCall, waitForResearchCall } from "./budget";
import { researchEvent } from "./service";
import { researchCallTraceFromHeaders } from "./call-trace";

vi.mock("@/lib/db", () => ({
  db: { researchCall: { findMany: vi.fn(async () => []) } },
}));
vi.mock("node:timers/promises", () => {
  const setTimeout = vi.fn(async (_ms, value, options) => {
    options?.signal?.throwIfAborted();
    return value;
  });
  return { setTimeout, default: { setTimeout } };
});
vi.mock("@/lib/crypto", () => ({
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
}));
vi.mock("@/lib/chat-profiles", () => ({
  getChatProfile: vi.fn(async () => ({
    enabled: true,
    apiKey: "[REDACTED]",
    model: "synthetic",
    baseUrl: "https://unused.invalid/v1",
  })),
}));
vi.mock("./budget", () => ({
  waitForResearchCall: vi.fn(async () => ({
    call: { id: "synthetic-call" },
    task: {
      modelId: "synthetic",
      id: "synthetic-task",
      executionToken: "synthetic-token",
      reasoningEffort: "medium",
      configSnapshot: {},
    },
  })),
  activeResearchAttempt: vi.fn(async () => ({
    stageId: "synthetic-stage",
    stage: {
      taskId: "synthetic-task",
      task: {
        id: "synthetic-task",
        llmCalls: 1,
        plan: { limits: { llm: 30 } },
        executionToken: "synthetic-token",
      },
    },
  })),
  finishResearchCall: vi.fn(async () => {}),
}));
vi.mock("./service", () => ({ researchEvent: vi.fn(async () => {}) }));

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("research streaming gateway", () => {
  const sse = (...events: unknown[]) =>
    new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      {
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  const complete = {
    type: "response.completed",
    response: {
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Recovered answer" }],
        },
      ],
    },
  };
  it("allows a bounded longer XHigh call without exceeding the task deadline", async () => {
    const original = await waitForResearchCall("synthetic-attempt", "llm", {});
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      for (const remaining of [900000, 30000]) {
        vi.mocked(waitForResearchCall).mockResolvedValueOnce({
          ...original,
          task: {
            ...original.task,
            reasoningEffort: "xhigh",
            deadlineAt: new Date(Date.now() + remaining),
          },
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(complete)));
        await researchModelCall(
          "synthetic-attempt",
          { messages: [] },
          () => {},
        );
        const delays = timer.mock.calls.map((call) => Number(call[1]));
        expect(
          delays.some(
            (ms) =>
              ms > Math.min(480000, remaining) - 1000 &&
              ms <= Math.min(480000, remaining),
          ),
        ).toBe(true);
        timer.mockClear();
      }
    } finally {
      timer.mockRestore();
    }
  });
  for (const scenario of ["active", "idle", "deadline", "hard_limit"] as const)
    it(`bounds a long stream by real progress: ${scenario}`, async () => {
      const original = await waitForResearchCall(
        "synthetic-attempt",
        "llm",
        {},
      );
      vi.useFakeTimers();
      vi.mocked(waitForResearchCall).mockResolvedValueOnce({
        ...original,
        task: {
          ...original.task,
          reasoningEffort: "xhigh",
          deadlineAt: new Date(
            Date.now() + (scenario === "deadline" ? 30000 : 1800000),
          ),
        },
      });
      let upstream!: ReadableStreamDefaultController<Uint8Array>;
      let signal!: AbortSignal;
      const encoder = new TextEncoder();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          signal = init.signal;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                upstream = controller;
                signal.addEventListener("abort", () =>
                  controller.error(signal.reason),
                );
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const emit = (event: unknown) =>
        upstream.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const pending = researchModelCall(
        "synthetic-attempt",
        { messages: [] },
        () => {},
      );
      const outcome = pending.then(
        (result) => ({ result, error: undefined }),
        (error) => ({ result: undefined, error }),
      );
      await vi.advanceTimersByTimeAsync(0);
      if (scenario === "deadline") {
        await vi.advanceTimersByTimeAsync(20000);
        emit({ type: "response.output_text.delta", delta: "Still writing" });
        await vi.advanceTimersByTimeAsync(10000);
      } else {
        await vi.advanceTimersByTimeAsync(420000);
        emit(
          scenario === "idle"
            ? { type: "response.in_progress" }
            : { type: "response.output_text.delta", delta: "Still writing" },
        );
        await vi.advanceTimersByTimeAsync(scenario === "idle" ? 60000 : 120000);
        if (scenario === "hard_limit") {
          emit({ type: "response.output_text.delta", delta: "More text" });
          await vi.advanceTimersByTimeAsync(300000);
          emit({ type: "response.output_text.delta", delta: "More text" });
          await vi.advanceTimersByTimeAsync(120000);
        }
      }
      if (scenario === "active") {
        expect(signal.aborted).toBe(false);
        emit(complete);
        upstream.close();
        expect((await outcome).result?.status).toBe("completed");
      } else {
        expect(signal.aborted).toBe(true);
        expect((await outcome).error).toMatchObject({
          code: "MODEL_CALL_TIMEOUT",
        });
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  it("preserves published leading whitespace when the final snapshot omits it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        sse(
          { type: "response.output_text.delta", delta: " " },
          { type: "response.output_text.delta", delta: "Recovered " },
          complete,
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const response = await chatCompatibleResearchResponse(
      "synthetic-attempt",
      { model: "synthetic", stream: true, messages: [] },
      new AbortController().signal,
    );
    const wire = await response.text();
    const chunks = wire
      .split("\n\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)));
    expect(
      chunks.map((row) => row.choices?.[0]?.delta?.content ?? "").join(""),
    ).toBe(" Recovered answer");
    expect(wire).toContain("[DONE]");
    expect(wire).not.toContain("DIVERGENT_OUTPUT");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("still rejects and records an actual change to published content", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        sse(
          { type: "response.output_text.delta", delta: "Different content" },
          complete,
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const response = await chatCompatibleResearchResponse(
      "synthetic-attempt",
      { model: "synthetic", stream: true, messages: [] },
      new AbortController().signal,
    );
    const wire = await response.text();
    expect(wire).toContain("DIVERGENT_OUTPUT");
    expect(wire).not.toContain("[DONE]");
    expect(researchEvent).toHaveBeenCalledWith(
      "synthetic-task",
      "call.stream_failed",
      expect.objectContaining({ code: "DIVERGENT_OUTPUT" }),
      "synthetic-token",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps a blank incomplete response as one failed call and records its usage", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          { type: "response.output_text.delta", delta: " " },
          {
            type: "response.incomplete",
            response: {
              incomplete_details: { reason: "max_output_tokens" },
              usage: { input_tokens: 3, output_tokens: 6 },
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        sse(
          { type: "response.output_text.delta", delta: "Recovered answer" },
          complete,
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const deltas: string[] = [];
    await expect(
      researchModelCall("synthetic-attempt", { messages: [] }, (event) => {
        if (event.type === "response.output_text.delta")
          deltas.push(event.delta);
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(deltas).toEqual([" "]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(finishResearchCall).toHaveBeenCalledWith(
      "synthetic-call",
      expect.objectContaining({
        usage: { input_tokens: 3, output_tokens: 6 },
        errorCode: "UPSTREAM_INCOMPLETE",
      }),
    );
  });
  it("does not replay published partial text or retry a content rejection", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      sse(
        { type: "response.output_text.delta", delta: "Published partial" },
        {
          type: "response.incomplete",
          response: { incomplete_details: { reason: "max_output_tokens" } },
        },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      researchModelCall("synthetic-attempt", { messages: [] }, () => {}),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(
      sse({
        type: "response.incomplete",
        response: { incomplete_details: { reason: "content_filter" } },
      }),
    );
    await expect(
      researchModelCall("synthetic-attempt", { messages: [] }, () => {}),
    ).rejects.toMatchObject({ details: { retryable: false } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retries a confirmed server failure at most twice before the first delta", async () => {
    const fetch = vi.fn().mockImplementation(async () =>
      sse({
        type: "response.failed",
        response: { error: { code: "server_error" } },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      researchModelCall("synthetic-attempt", { messages: [] }, () => {}),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(finishResearchCall).toHaveBeenCalledTimes(3);
  });
  it("does not retry a no-output HTTP 503 when the application permits one attempt", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(sse(complete));
    vi.stubGlobal("fetch", fetch);
    const onEvent = vi.fn();
    await expect(
      researchModelCall(
        "synthetic-attempt",
        { messages: [] },
        onEvent,
        undefined,
        { purpose: "research.editorial" },
        { maxAttempts: 1 },
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      details: { httpStatus: 503 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(waitForResearchCall).toHaveBeenCalledTimes(1);
    expect(finishResearchCall).toHaveBeenCalledTimes(1);
    expect(onEvent).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(researchEvent)
        .mock.calls.filter((call) => call[1] === "call.retry_scheduled"),
    ).toEqual([]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty(
      "maxAttempts",
    );
  });
  it("retains the default bounded HTTP retry before any output", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(sse(complete));
    vi.stubGlobal("fetch", fetch);
    const result = await researchModelCall(
      "synthetic-attempt",
      { messages: [] },
      () => {},
    );
    expect(responseText(result)).toBe("Recovered answer");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(waitForResearchCall).toHaveBeenCalledTimes(3);
    expect(finishResearchCall).toHaveBeenCalledTimes(3);
    expect(
      vi
        .mocked(researchEvent)
        .mock.calls.filter((call) => call[1] === "call.retry_scheduled")
        .map((call) => call[2]),
    ).toEqual([
      expect.objectContaining({ retry: 1, delayMs: 2000 }),
      expect.objectContaining({ retry: 2, delayMs: 4000 }),
    ]);
  });
  it("honors a two-attempt limit without changing the retry failure classes", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response("Unavailable", { status: 503 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      researchModelCall(
        "synthetic-attempt",
        { messages: [] },
        () => {},
        undefined,
        undefined,
        { maxAttempts: 2 },
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(waitForResearchCall).toHaveBeenCalledTimes(2);
    expect(researchEvent).toHaveBeenCalledWith(
      "synthetic-task",
      "call.retry_scheduled",
      expect.objectContaining({
        retry: 1,
        message: "模型服务暂时异常，2 秒后自动重试（1/1）",
      }),
      "synthetic-token",
    );
  });
  it("never replays partial text even when a three-attempt policy permits an empty server retry", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      sse(
        { type: "response.output_text.delta", delta: "Partial editorial text" },
        {
          type: "response.failed",
          response: { error: { code: "server_error" } },
        },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const deltas: string[] = [];
    await expect(
      researchModelCall(
        "synthetic-attempt",
        { messages: [] },
        (event) => {
          if (event.type === "response.output_text.delta")
            deltas.push(event.delta);
        },
        undefined,
        undefined,
        { maxAttempts: 3 },
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_INCOMPLETE",
      details: { reason: "server_error" },
    });
    expect(deltas).toEqual(["Partial editorial text"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(waitForResearchCall).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(researchEvent)
        .mock.calls.filter((call) => call[1] === "call.retry_scheduled"),
    ).toEqual([]);
  });
  it.each([0, -1, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid attempt limit %s before reserving a call",
    async (maxAttempts) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(
        researchModelCall(
          "synthetic-attempt",
          { messages: [] },
          () => {},
          undefined,
          undefined,
          { maxAttempts },
        ),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_RETRY_POLICY" });
      expect(waitForResearchCall).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(researchEvent).not.toHaveBeenCalled();
    },
  );
  it("records bounded runtime trace hints without forwarding them or changing model parameters", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(sse(complete));
    vi.stubGlobal("fetch", fetch);
    const trace = researchCallTraceFromHeaders(
      new Headers({
        "X-Chugao-Call-Purpose": "research.write_report",
        "X-Chugao-Task-Spec-Hash": "a".repeat(64),
        "X-Chugao-Context-Hash": "../../not-a-hash",
        "X-Chugao-Max-Budget": "99999",
      }),
    );
    const result = await researchModelCall(
      "synthetic-attempt",
      { messages: [], max_output_tokens: 4000 },
      () => {},
      undefined,
      trace,
    );
    expect(responseText(result)).toBe("Recovered answer");
    expect(trace).toEqual({
      purpose: "research.write_report",
      declaredTaskSpecHash: "a".repeat(64),
    });
    expect(researchEvent).toHaveBeenCalledWith(
      "synthetic-task",
      "call.trace",
      expect.objectContaining({
        callId: "synthetic-call",
        purpose: "research.write_report",
        upstreamRequestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      "synthetic-token",
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_output_tokens).toBe(
      4000,
    );
    expect(JSON.stringify(fetch.mock.calls[0][1])).not.toContain("X-Chugao");
  });
  it("does not replay an uncertain network request", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("synthetic connection reset"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      researchModelCall("synthetic-attempt", { messages: [] }, () => {}),
    ).rejects.toThrow("connection reset");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps an idle SDK stream alive without adding text and clears timers on completion", async () => {
    vi.useFakeTimers();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                upstream = controller;
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    const response = await chatCompatibleResearchResponse(
      "synthetic-attempt",
      { model: "synthetic", stream: true, messages: [] },
      new AbortController().signal,
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read();
    await vi.advanceTimersByTimeAsync(15000);
    const heartbeat = decoder.decode((await reader.read()).value);
    expect(JSON.parse(heartbeat.slice(6)).choices[0].delta).toEqual({});
    upstream.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Actual answer" }] }] } })}\n\n`,
      ),
    );
    upstream.close();
    let tail = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += decoder.decode(chunk.value);
    }
    expect(tail).toContain("Actual answer");
    expect(tail).toContain("[DONE]");
    expect(vi.getTimerCount()).toBe(0);
  });
});

