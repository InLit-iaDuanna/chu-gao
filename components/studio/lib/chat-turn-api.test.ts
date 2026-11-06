// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatTurnView } from "@/lib/chat-turn-types";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  request: mocks.request,
}));
import {
  cancelManagedChat,
  chatActivityText,
  followChatTurn,
  retryManagedChat,
} from "./chat-turn-api";

const view: ChatTurnView = {
  id: "turn",
  conversationId: "conversation",
  modelId: "gpt-6.1-sol",
  status: "running",
  attemptId: "attempt",
  attemptNumber: 1,
  text: "",
  sources: [],
  usage: null,
  error: null,
  priceCredits: 0.2,
  chargedCredits: 0,
  billingState: "reserved",
  lastSeq: 0,
};
const event = (
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  attemptId = "attempt",
) => ({ v: 1, turnId: "turn", attemptId, seq, type, payload });
const response = (events: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        events.forEach((value) =>
          controller.enqueue(
            new TextEncoder().encode(
              `event: turn\ndata: ${JSON.stringify(value)}\n\n`,
            ),
          ),
        );
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
const handlers = () => ({
  onDelta: vi.fn(),
  onReplace: vi.fn(),
  onError: vi.fn(),
  onDone: vi.fn(),
  onStatus: vi.fn(),
  onTurn: vi.fn(),
  onConnection: vi.fn(),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("durable chat subscription", () => {
  it("describes bounded automatic continuation while retaining the active task", () => {
    expect(
      chatActivityText({
        ...view,
        activity: "retrying",
        text: "saved",
        parts: { recovery: { used: 1, limit: 2, continuing: true } },
      }),
    ).toBe("连接中断，正在续写（1/2）…");
  });
  it("deduplicates sequence numbers and reconciles final text instead of appending it", async () => {
    mocks.request.mockResolvedValue({
      ...view,
      status: "completed",
      text: "A",
      lastSeq: 2,
    });
    const fetch = vi.fn(async () =>
      response([
        event(1, "text.delta", { text: "A", offset: 0 }),
        event(1, "text.delta", { text: "A", offset: 0 }),
        event(2, "attempt.terminal", { text: "A", status: "completed" }),
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const callbacks = handlers();
    await followChatTurn(view, callbacks);
    expect(callbacks.onDelta.mock.calls).toEqual([["A"]]);
    expect(callbacks.onReplace).toHaveBeenLastCalledWith("A");
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("reconnects using a snapshot and cursor without starting another generation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response([event(1, "text.delta", { text: "A", offset: 0 })]),
      )
      .mockResolvedValueOnce(
        response([
          event(1, "text.delta", { text: "A", offset: 0 }),
          event(2, "text.delta", { text: "B", offset: 1 }),
          event(3, "attempt.terminal", { text: "AB", status: "completed" }),
        ]),
      );
    vi.stubGlobal("fetch", fetch);
    mocks.request
      .mockResolvedValueOnce({ ...view, text: "A", lastSeq: 1 })
      .mockResolvedValue({
        ...view,
        status: "completed",
        text: "AB",
        lastSeq: 3,
      });
    const callbacks = handlers();
    await followChatTurn(view, callbacks);
    expect(callbacks.onDelta.mock.calls).toEqual([["A"], ["B"]]);
    expect(fetch.mock.calls[1][0]).toContain("after=1");
    expect(mocks.request).toHaveBeenCalledWith("/api/chat/turns/turn");
    expect(
      fetch.mock.calls.every(
        (call) => !call[1]?.method || call[1].method === "GET",
      ),
    ).toBe(true);
  });

  it("does not treat partial text followed by failure as success", async () => {
    mocks.request.mockResolvedValue({
      ...view,
      status: "failed",
      text: "partial",
      lastSeq: 2,
      error: { message: "Saved partial; no charge" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response([
          event(1, "text.delta", { text: "partial", offset: 0 }),
          event(2, "attempt.terminal", {
            text: "partial",
            status: "failed",
            error: { message: "Saved partial; no charge" },
          }),
        ]),
      ),
    );
    const callbacks = handlers();
    await followChatTurn(view, callbacks);
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith("Saved partial; no charge");
  });

  it("ignores terminals of old attempts during replay", async () => {
    mocks.request
      .mockResolvedValueOnce({ ...view, lastSeq: 1 })
      .mockResolvedValue({
        ...view,
        status: "completed",
        text: "new",
        lastSeq: 3,
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response([
          event(1, "attempt.terminal", { status: "failed" }, "old-attempt"),
          event(2, "text.delta", { text: "new", offset: 0 }),
          event(3, "attempt.terminal", { text: "new", status: "completed" }),
        ]),
      ),
    );
    const callbacks = handlers();
    await followChatTurn(view, callbacks);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onDone).toHaveBeenCalledOnce();
  });

  it("subscriber cancellation never calls the task cancel endpoint", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response([event(1, "text.delta", { text: "A", offset: 0 })]),
    );
    vi.stubGlobal("fetch", fetch);
    const callbacks = handlers();
    callbacks.onDelta.mockImplementation(() => controller.abort());
    await followChatTurn(view, callbacks, controller.signal);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("/events?");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("continues the newest attempt when an old terminal arrives after retry", async () => {
    const next = {
      ...view,
      attemptId: "new-attempt",
      attemptNumber: 2,
      text: "new",
      lastSeq: 3,
    };
    mocks.request.mockResolvedValueOnce(next).mockResolvedValue({
      ...next,
      status: "completed",
      text: "new final",
      lastSeq: 5,
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response([
          event(1, "attempt.terminal", {
            status: "failed",
            error: { message: "old failure" },
          }),
          event(2, "text.delta", { text: "stale", offset: 0 }),
        ]),
      )
      .mockResolvedValueOnce(
        response([
          event(4, "text.delta", { text: " final", offset: 3 }, "new-attempt"),
          event(5, "attempt.terminal", { status: "completed" }, "new-attempt"),
        ]),
      );
    vi.stubGlobal("fetch", fetch);
    const callbacks = handlers();
    await followChatTurn(view, callbacks);
    expect(fetch.mock.calls[1][0]).toContain("after=3");
    expect(callbacks.onDelta.mock.calls).toEqual([[" final"]]);
    expect(callbacks.onTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attemptId: "new-attempt",
        text: "new final",
        status: "completed",
      }),
    );
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("restores sources and usage from partial failure snapshots and delivers citation updates", async () => {
    const sources = [{ url: "https://example.com/source", title: "Source" }];
    const usage = { input_tokens: 10, output_tokens: 2 };
    mocks.request.mockResolvedValue({
      ...view,
      text: "partial",
      status: "failed",
      sources,
      usage,
      lastSeq: 3,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response([
          event(1, "text.delta", { offset: 0, text: "partial" }),
          event(2, "citations.updated", { sources }),
          event(3, "attempt.terminal", { status: "failed" }),
        ]),
      ),
    );
    const callbacks = handlers();
    await followChatTurn(view, callbacks);
    expect(callbacks.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sources, lastSeq: 2 }),
    );
    expect(callbacks.onTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ sources, usage, status: "failed" }),
    );
    expect(callbacks.onDone).not.toHaveBeenCalled();
  });

  it("bounds recovery when snapshots cannot confirm a terminal, without resubmitting", async () => {
    vi.useFakeTimers();
    mocks.request.mockRejectedValue(new Error("snapshot unavailable"));
    const fetch = vi.fn(async () =>
      response([event(1, "attempt.terminal", { status: "completed" })]),
    );
    vi.stubGlobal("fetch", fetch);
    const callbacks = handlers();
    const following = followChatTurn(view, callbacks);
    await vi.runAllTimersAsync();
    await following;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls.length).toBeLessThanOrEqual(8);
    expect(callbacks.onConnection).toHaveBeenLastCalledWith("disconnected");
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "running" }),
    );
  });

  it("targets cancel and retry to the observed attempt", async () => {
    mocks.request.mockResolvedValue(view);
    await cancelManagedChat("turn", "attempt");
    await retryManagedChat("turn", "request-key", "attempt");
    expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({
      expectedAttemptId: "attempt",
    });
    expect(JSON.parse(mocks.request.mock.calls[1][1].body)).toEqual({
      clientRequestId: "request-key",
      expectedPreviousAttemptId: "attempt",
    });
  });

  it("calibrates the latest snapshot on focus without a new generation", async () => {
    const browser = new EventTarget();
    vi.stubGlobal("window", browser);
    const callbacks = handlers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new ReadableStream<Uint8Array>())),
    );
    mocks.request.mockResolvedValue({
      ...view,
      text: "latest",
      lastSeq: 5,
      status: "completed",
    });
    const following = followChatTurn(view, callbacks);
    await vi.waitFor(() =>
      expect(callbacks.onConnection).toHaveBeenCalledWith("connected"),
    );
    browser.dispatchEvent(new Event("focus"));
    await following;
    expect(callbacks.onReplace).toHaveBeenLastCalledWith("latest");
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls).toEqual([["/api/chat/turns/turn"]]);
  });
});
