import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  references: vi.fn(),
  transaction: vi.fn(),
  config: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  checkSession: async () => ({ status: "authenticated", user: { id: "me" } }),
  authenticatedUser: () => ({ id: "me" }),
}));
vi.mock("@/lib/api-rate-limit", () => ({
  userActionRateLimitResponse: async () => null,
}));
vi.mock("@/lib/chat-references", () => ({
  resolveChatReferences: mocks.references,
}));
vi.mock("@/lib/ai-config", () => ({
  getConversationConfig: mocks.config,
  getConversationPricing: async () => ({}),
  getConversationSystemPrompt: async () => "",
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { POST } from "@/app/api/conversations/chat/route";
const request = (value: unknown) =>
  new Request("http://localhost/api/conversations/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({ enabled: false });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("retired chat reference entry point", () => {
  it("requires upgrade before validating an oversized reference request or reserving funds", async () => {
    const response = await POST(
      request({
        messages: [{ role: "user", content: "prompt" }],
        referenceImageKeys: Array.from(
          { length: 8 },
          (_, i) => `uploads/me/${i}.png`,
        ),
        sourceImageIds: ["image"],
      }),
    );
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "CLIENT_UPGRADE_REQUIRED" },
    });
    expect(mocks.references).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it("does not resolve missing private assets, charge, or call upstream for a legacy request", async () => {
    mocks.references.mockRejectedValue(new Error("not found"));
    const response = await POST(
      request({
        messages: [{ role: "user", content: "prompt" }],
        referenceImageKeys: ["uploads/me/a.png"],
      }),
    );
    expect(response.status).toBe(426);
    expect(mocks.references).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
