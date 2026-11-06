import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/network", () => ({ getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/rate-limit", () => ({ checkUserActionRateLimit: vi.fn() }));
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  revoke: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  checkSession: mocks.session,
  sessionFailureResponse: (value: { status: string }) =>
    value.status === "authenticated"
      ? null
      : new Response(null, { status: 401 }),
  authenticatedUser: (value: { user: unknown }) => value.user,
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: mocks.lock,
        agentAuthorization: { updateMany: mocks.revoke },
      }),
  },
}));
import {
  agentBrowserUser,
  revokeAgentAuthorization,
} from "@/lib/agent-browser";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    user: { id: "owner" },
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("Agent browser consent boundaries", () => {
  it("accepts the configured HTTPS origin behind an internal reverse proxy URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_CANONICAL_HOST", "chugao.art");
    const result = await agentBrowserUser(
      new Request("http://container:3000/api/agent/authorize", {
        headers: { Origin: "https://chugao.art" },
      }),
      true,
    );
    expect(result.user).toEqual({ id: "owner" });
  });
  it("rejects foreign and missing origins before validating a browser session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_CANONICAL_HOST", "chugao.art");
    for (const origin of ["https://attacker.invalid", ""]) {
      const headers = new Headers();
      if (origin) headers.set("Origin", origin);
      const result = await agentBrowserUser(
        new Request("http://container:3000/api/agent/authorize", { headers }),
        true,
      );
      expect(result.response?.status).toBe(403);
    }
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("serializes revocation with task creation and never revokes another user's grant", async () => {
    mocks.revoke.mockResolvedValue({ count: 0 });
    await expect(
      revokeAgentAuthorization("owner", "foreign-grant"),
    ).rejects.toThrow("授权不存在");
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.revoke).toHaveBeenCalledWith({
      where: { id: "foreign-grant", userId: "owner" },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
