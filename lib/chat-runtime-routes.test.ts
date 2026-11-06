// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  failure: vi.fn(),
  audit: vi.fn(),
  update: vi.fn(),
  status: vi.fn(),
  online: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  checkSession: mocks.session,
  adminFailureResponse: mocks.failure,
  authenticatedUser: () => ({ id: "admin-a" }),
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/chat-runtime-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-runtime-config")>()),
  setChatRuntimeConfig: mocks.update,
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/chat-runtime-health", () => ({
  getChatRuntimeStatus: mocks.status,
  chatWorkerOnline: mocks.online,
}));
import { GET, PATCH } from "@/app/api/admin/chat-runtime/route";
import { GET as health } from "@/app/api/health/chat/route";

describe("chat runtime admin and public health endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.failure.mockReturnValue(null);
    mocks.update.mockResolvedValue({ enabled: false });
    mocks.status.mockResolvedValue({
      config: { enabled: true },
      protocolVersion: 2,
      health: { online: true, instances: [] },
      drained: false,
    });
  });
  it("requires admin authorization before reading or writing runtime settings", async () => {
    mocks.failure.mockReturnValue(new Response(null, { status: 403 }));
    expect((await GET(new Request("http://fixture/admin"))).status).toBe(403);
    expect(
      (
        await PATCH(
          new Request("http://fixture/admin", { method: "PATCH", body: "{}" }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("validates patches and audits runtime-only changes", async () => {
    const invalid = await PATCH(
      new Request("http://fixture/admin", {
        method: "PATCH",
        body: '{"apiKey":"not-runtime-config"}',
      }),
    );
    expect(invalid.status).toBe(400);
    const response = await PATCH(
      new Request("http://fixture/admin", {
        method: "PATCH",
        body: '{"enabled":false}',
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      { enabled: false },
      "admin-a",
    );
    expect(mocks.audit.mock.calls[0][0]).toMatchObject({
      action: "admin.chat.runtime.update",
      target: "chat.runtime",
      diff: { enabled: false },
    });
  });
  it("does not expose instance/build/user details through the public health endpoint", async () => {
    mocks.online.mockResolvedValue(false);
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "CHAT_WORKER_UNAVAILABLE",
        details: { protocolVersion: 2 },
      },
    });
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
