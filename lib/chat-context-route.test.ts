import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rate: vi.fn(),
  status: vi.fn(),
  compact: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  checkSession: mocks.session,
  sessionFailureResponse: (session: { status: string }) =>
    session.status === "authenticated"
      ? null
      : Response.json(
          { ok: false },
          { status: session.status === "unavailable" ? 503 : 401 },
        ),
  authenticatedUser: (session: { user: { id: string } }) => session.user,
}));
vi.mock("@/lib/api-rate-limit", () => ({
  userActionRateLimitResponse: mocks.rate,
}));
vi.mock("@/lib/chat-context", async () => ({
  ChatContextError: (await import("@/lib/chat-context-types")).ChatContextError,
  getChatContextStatus: mocks.status,
  compactChatContext: mocks.compact,
}));
vi.mock("@/lib/service-errors", () => ({
  isDatabaseUnavailableError: () => false,
}));

import { GET, POST } from "@/app/api/conversations/context/route";
import { ChatContextError } from "@/lib/chat-context-types";

const status = {
  estimatedTokens: 150,
  budgetTokens: 24_000,
  messageCount: 8,
  compactedMessages: 0,
  summary: null,
  canCompact: false,
};
const getRequest = (query = "conversationId=chat-a") =>
  new Request(`http://localhost/api/conversations/context?${query}`);
const postRequest = (
  data: unknown = { conversationId: "chat-a", modelId: "gpt-5.6-luna" },
) =>
  new Request("http://localhost/api/conversations/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    user: { id: "alice" },
  });
  mocks.rate.mockResolvedValue(null);
  mocks.status.mockResolvedValue(status);
  mocks.compact.mockResolvedValue(status);
});

describe("context status and manual compaction API", () => {
  it("returns authenticated user's status in the existing envelope with no-store", async () => {
    const response = await GET(getRequest());
    expect(await response.json()).toEqual({ ok: true, data: status });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.status).toHaveBeenCalledWith("alice", "chat-a");
  });

  it("selects the requested summary profile without trusting a client manifest", async () => {
    const response = await GET(
      getRequest("conversationId=chat-a&modelId=gpt-6.1-sol"),
    );
    expect(response.status).toBe(200);
    expect(mocks.status).toHaveBeenCalledWith("alice", "chat-a", "gpt-6.1-sol");
    expect(
      (await GET(getRequest("conversationId=chat-a&modelId=unknown"))).status,
    ).toBe(400);
    expect(mocks.status).toHaveBeenCalledTimes(1);
  });

  it("manually compacts only stored history at two requests per minute", async () => {
    const request = postRequest();
    const response = await POST(request);
    expect(await response.json()).toEqual({ ok: true, data: status });
    expect(mocks.rate).toHaveBeenCalledWith(
      "alice",
      "conversation-context-compact",
      undefined,
      2,
    );
    expect(mocks.compact).toHaveBeenCalledWith({
      userId: "alice",
      conversationId: "chat-a",
      modelId: "gpt-5.6-luna",
      signal: request.signal,
    });
    expect(mocks.compact.mock.calls[0][0]).not.toHaveProperty("latestMessage");
  });

  it.each(["unauthenticated", "unavailable"])(
    "rejects %s sessions before reading or summarizing",
    async (state) => {
      mocks.session.mockResolvedValue({ status: state });
      expect((await GET(getRequest())).status).toBe(
        state === "unavailable" ? 503 : 401,
      );
      expect((await POST(postRequest())).status).toBe(
        state === "unavailable" ? 503 : 401,
      );
      expect(mocks.status).not.toHaveBeenCalled();
      expect(mocks.compact).not.toHaveBeenCalled();
      expect(mocks.rate).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { conversationId: "chat-a", modelId: "unknown" },
    {
      conversationId: "chat-a",
      modelId: "default",
      messages: [{ role: "user", content: "Client history" }],
    },
    { conversationId: "chat-a", modelId: "default", userId: "bob" },
  ])(
    "rejects invalid IDs, models and client-owned history or identity",
    async (data) => {
      expect((await POST(postRequest(data))).status).toBe(400);
      expect(mocks.compact).not.toHaveBeenCalled();
    },
  );

  it("rejects missing IDs and malformed JSON", async () => {
    expect((await GET(getRequest(""))).status).toBe(400);
    const invalid = new Request("http://localhost/api/conversations/context", {
      method: "POST",
      body: "{",
    });
    expect((await POST(invalid)).status).toBe(400);
    expect(mocks.compact).not.toHaveBeenCalled();
  });

  it("does not call the service after a rate limit decision", async () => {
    mocks.rate.mockImplementation(async () =>
      Response.json(
        { ok: false, error: { code: "RATE_LIMITED" } },
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    );
    const response = await POST(postRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(mocks.compact).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", 404],
    ["CHAT_CONTEXT_BUSY", 409],
    ["CHAT_CONTEXT_SUMMARY_FAILED", 502],
    ["CHAT_CONTEXT_TIMEOUT", 504],
  ])(
    "returns explicit %s failures without turning them into success",
    async (code, httpStatus) => {
      mocks.compact.mockRejectedValue(
        new ChatContextError(String(code), "Public error", Number(httpStatus)),
      );
      const response = await POST(postRequest());
      expect(response.status).toBe(httpStatus);
      expect(await response.json()).toEqual({
        ok: false,
        error: { code, message: "Public error" },
      });
    },
  );

  it("returns not-found on ownership failure and sanitizes unexpected backend errors", async () => {
    mocks.status.mockRejectedValue(
      new ChatContextError("NOT_FOUND", "对话不存在", 404),
    );
    expect((await GET(getRequest())).status).toBe(404);
    mocks.status.mockRejectedValue(new Error("private backend details"));
    const response = await GET(getRequest());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private backend details");
  });
});
