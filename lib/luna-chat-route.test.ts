import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  catalog: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ checkSession: mocks.session }));
vi.mock("@/lib/chat-models", () => ({ getChatCatalog: mocks.catalog }));
import { GET, POST } from "@/app/api/conversations/chat/route";

describe("retired chat execution protocol", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({
      status: "authenticated",
      user: { id: "synthetic" },
    });
    mocks.catalog.mockResolvedValue({ models: [] });
  });
  it.each([
    {},
    { conversationId: "conversation", modelId: "gpt-5.6-luna" },
    { modelId: "gpt-6.1-sol", stream: true },
  ])("rejects cached clients before parsing/execution: %j", async (body) => {
    const response = await POST(
      new Request("http://localhost/api/conversations/chat", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({
      error: { code: "CLIENT_UPGRADE_REQUIRED" },
    });
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("retains authenticated catalog reads", async () => {
    expect(
      (await GET(new Request("http://localhost/api/conversations/chat")))
        .status,
    ).toBe(200);
    expect(mocks.catalog).toHaveBeenCalledOnce();
  });
  it.each([
    ["unauthenticated", 401],
    ["unavailable", 503],
  ])("keeps auth failures (%s)", async (status, expected) => {
    mocks.session.mockResolvedValue({ status });
    expect(
      (
        await POST(
          new Request("http://localhost/api/conversations/chat", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(expected);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
