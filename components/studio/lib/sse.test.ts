import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { streamConversationChat } from "./sse";

const mocks = vi.hoisted(() => ({ managed: vi.fn() }));
vi.mock("./chat-turn-api", () => ({ streamManagedChat: mocks.managed }));
const handlers = () => ({
  onDelta: vi.fn(),
  onDone: vi.fn(),
  onError: vi.fn(),
});
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

it.each([true, false, undefined])(
  "uses only managed chat regardless of the old durable flag: %s",
  async (durable) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const callbacks = handlers();
    const signal = new AbortController().signal;
    await streamConversationChat({
      messages: [
        { role: "assistant", content: "history" },
        { role: "user", content: "current" },
      ],
      userId: "user",
      conversationId: "conversation",
      durable,
      modelId: "gpt-6.1-sol",
      reasoningEffort: "high",
      webSearch: true,
      referenceImageKeys: ["upload"],
      sourceImageIds: ["generated"],
      references: [
        { kind: "generated", id: "generated" },
        { kind: "upload", key: "upload" },
      ],
      signal,
      handlers: callbacks,
    });
    expect(mocks.managed).toHaveBeenCalledWith({
      userId: "user",
      conversationId: "conversation",
      content: "current",
      modelId: "gpt-6.1-sol",
      reasoningEffort: "high",
      webSearch: true,
      referenceImageKeys: ["upload"],
      sourceImageIds: ["generated"],
      references: [
        { kind: "generated", id: "generated" },
        { kind: "upload", key: "upload" },
      ],
      signal,
      handlers: callbacks,
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each([{ userId: "user" }, { conversationId: "conversation" }, {}])(
  "refuses an unidentified request without a legacy fallback: %j",
  async (identity) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const callbacks = handlers();
    await streamConversationChat({
      ...identity,
      messages: [{ role: "user", content: "text" }],
      handlers: callbacks,
    });
    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect(mocks.managed).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("does not submit if the subscriber was already canceled", async () => {
  const controller = new AbortController();
  controller.abort();
  const callbacks = handlers();
  await streamConversationChat({
    userId: "user",
    conversationId: "conversation",
    messages: [],
    signal: controller.signal,
    handlers: callbacks,
  });
  expect(mocks.managed).not.toHaveBeenCalled();
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it("reports uncertain submission errors without treating them as a successful reply", async () => {
  mocks.managed.mockRejectedValue(new Error("pending receipt"));
  const callbacks = handlers();
  await streamConversationChat({
    userId: "user",
    conversationId: "conversation",
    messages: [],
    handlers: callbacks,
  });
  expect(callbacks.onError).toHaveBeenCalledWith("pending receipt");
  expect(callbacks.onDone).not.toHaveBeenCalled();
});
