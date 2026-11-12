import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatTurnInput, ChatTurnView } from "@/lib/chat-turn-types";
import { ApiError } from "./api";
import {
  chatReceiptKey,
  prepareChatCreate,
  prepareChatSubmission,
  readChatReceipt,
  resolveChatSubmission,
} from "./chat-submission";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  request: mocks.request,
}));
const input: Omit<ChatTurnInput, "clientRequestId"> = {
  conversationId: "conversation",
  content: "original",
  modelId: "gpt-6.1-sol",
  referenceImageKeys: ["upload"],
  sourceImageIds: ["generated"],
  references: [
    { kind: "generated", id: "generated", label: "图1" },
    { kind: "upload", key: "upload", label: "图2" },
  ],
};
const turn = {
  id: "turn",
  conversationId: "conversation",
  attemptId: "attempt",
} as ChatTurnView;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

it("persists before submission and replays the same immutable input after unknown ACK", async () => {
  const pending = prepareChatCreate("user", input);
  mocks.request
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "offline", 0));
  await expect(resolveChatSubmission("user", "conversation")).rejects.toThrow(
    "提交结果尚未确认",
  );
  expect(readChatReceipt("user", "conversation")?.pending).toEqual(pending);
  expect(
    prepareChatCreate("user", {
      ...input,
      content: "new draft",
      references: [],
    }),
  ).toEqual(pending);
  mocks.request.mockResolvedValueOnce(null).mockResolvedValueOnce(turn);
  expect(await resolveChatSubmission("user", "conversation")).toEqual(turn);
  const writes = mocks.request.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(writes).toHaveLength(2);
  expect(writes[1][1].body).toBe(writes[0][1].body);
  expect(JSON.parse(writes[1][1].body).references).toEqual(input.references);
  expect(readChatReceipt("user", "conversation")).toEqual({
    version: 1,
    turnId: "turn",
  });
});

it("isolates receipts by authenticated user and conversation", () => {
  const a = prepareChatCreate("user-a", input);
  const b = prepareChatCreate("user-b", input);
  const c = prepareChatCreate("user-a", { ...input, conversationId: "other" });
  expect(readChatReceipt("user-a", "conversation")?.pending).toEqual(a);
  expect(readChatReceipt("user-b", "conversation")?.pending).toEqual(b);
  expect(readChatReceipt("user-a", "other")?.pending).toEqual(c);
  expect(a).not.toEqual(b);
  expect(mocks.request).not.toHaveBeenCalled();
});

it("refuses a new request if durable browser storage is unavailable or unreadable", () => {
  const setter = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  expect(() => prepareChatCreate("user", input)).toThrow("无法保存发送凭据");
  expect(mocks.request).not.toHaveBeenCalled();
  setter.mockRestore();
  localStorage.setItem(chatReceiptKey("user", "conversation"), "broken JSON");
  expect(() => prepareChatCreate("user", input)).toThrow("无法读取发送凭据");
  expect(localStorage.getItem(chatReceiptKey("user", "conversation"))).toBe(
    "broken JSON",
  );
});

it("never replays cleared content or creates a fresh key automatically", async () => {
  prepareChatCreate("user", input);
  mocks.request.mockRejectedValueOnce(
    new ApiError("CONTENT_CLEARED", "cleared", 410),
  );
  await expect(resolveChatSubmission("user", "conversation")).rejects.toThrow(
    "不会重新执行",
  );
  expect(readChatReceipt("user", "conversation")).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0][0]).toContain("clientRequestId=");
});

it("keeps retry key and expected previous attempt across uncertain acknowledgements", async () => {
  const operation = prepareChatSubmission("user", "conversation", () => ({
    kind: "retry",
    turnId: "turn",
    clientRequestId: "retry-key",
    expectedPreviousAttemptId: "attempt",
  }));
  mocks.request
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new ApiError("HTTP_502", "gateway", 502));
  await expect(resolveChatSubmission("user", "conversation")).rejects.toThrow(
    "提交结果尚未确认",
  );
  expect(
    prepareChatSubmission("user", "conversation", () => ({
      kind: "retry",
      turnId: "turn",
      clientRequestId: "new-key",
      expectedPreviousAttemptId: "new-attempt",
    })),
  ).toEqual(operation);
  mocks.request.mockResolvedValueOnce({ ...turn, attemptId: "attempt-2" });
  expect((await resolveChatSubmission("user", "conversation"))?.attemptId).toBe(
    "attempt-2",
  );
  expect(
    mocks.request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(JSON.parse(mocks.request.mock.calls[1][1].body)).toEqual({
    clientRequestId: "retry-key",
    expectedPreviousAttemptId: "attempt",
  });
});

it("does not erase another tab's newer pending receipt when an old ACK arrives", async () => {
  prepareChatCreate("user", input);
  const newer = {
    kind: "retry",
    turnId: "turn",
    clientRequestId: "newer-key",
    expectedPreviousAttemptId: "attempt",
  };
  mocks.request.mockImplementationOnce(async () => {
    localStorage.setItem(
      chatReceiptKey("user", "conversation"),
      JSON.stringify({ version: 1, turnId: "turn", pending: newer }),
    );
    return turn;
  });
  await resolveChatSubmission("user", "conversation");
  expect(readChatReceipt("user", "conversation")?.pending).toEqual(newer);
});
