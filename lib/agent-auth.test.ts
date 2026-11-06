import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDevice: vi.fn(),
  device: vi.fn(),
  updateDevice: vi.fn(),
  grant: vi.fn(),
  updateGrant: vi.fn(),
  createGrant: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const client = {
    $executeRaw: vi.fn(),
    agentDeviceAuthorization: {
      create: mocks.createDevice,
      findUnique: mocks.device,
      update: mocks.updateDevice,
    },
    agentAuthorization: {
      findUnique: mocks.grant,
      update: mocks.updateGrant,
      create: mocks.createGrant,
    },
    user: { findUnique: mocks.user },
  };
  return {
    db: {
      ...client,
      $transaction: (fn: (tx: unknown) => unknown) => fn(client),
    },
  };
});
vi.mock("@/lib/rate-limit", () => ({ checkUserActionRateLimit: vi.fn() }));
vi.mock("@/lib/network", () => ({ getClientIp: () => "127.0.0.1" }));
import {
  authorizationExpiry,
  createDeviceAuthorization,
  decideDeviceAuthorization,
  exchangeDeviceCode,
  normalizeUserCode,
  requireAgent,
  secretHash,
} from "@/lib/agent-auth";

const now = new Date("2026-10-20T10:00:00Z");
function grant(overrides = {}) {
  return {
    id: "grant-1",
    userId: "user-1",
    clientName: "My Agent",
    mode: "timed",
    sessionVersion: 2,
    tokenHash: null,
    revokedAt: null,
    lastUsedAt: null,
    boundGenerationId: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 3600_000),
    user: {
      id: "user-1",
      email: "user@example.test",
      credits: 100,
      status: "ACTIVE",
      sessionVersion: 2,
    },
    ...overrides,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Agent device authorization", () => {
  it("issues short-lived codes while persisting only their hashes", async () => {
    const result = await createDeviceAuthorization(
      new Request("http://127.0.0.1:3001/api/agent/device-authorization"),
      "My Agent",
    );
    const saved = mocks.createDevice.mock.calls[0][0].data;
    expect(saved.deviceCodeHash).toBe(secretHash(result.device_code));
    expect(saved.userCodeHash).toBe(
      secretHash(normalizeUserCode(result.user_code)),
    );
    expect(JSON.stringify(saved)).not.toContain(result.device_code);
    expect(JSON.stringify(saved)).not.toContain(result.user_code);
    expect(result.expires_in).toBe(600);
    expect(result.interval).toBe(5);
    expect(result.verification_uri_complete).toContain(
      "/app/agent/authorize?user_code=",
    );
  });
  it("bounds custom duration and never grants indefinite authorization", () => {
    expect(
      authorizationExpiry("timed", 720, now).getTime() - now.getTime(),
    ).toBe(30 * 86400_000);
    expect(
      authorizationExpiry("single", undefined, now).getTime() - now.getTime(),
    ).toBe(86400_000);
    for (const hours of [0, 721, 1.5, NaN, Infinity])
      expect(() => authorizationExpiry("timed", hours, now)).toThrow();
  });
  it("does not issue a token before consent, after denial, or after expiry", async () => {
    const row = {
      id: "code",
      expiresAt: new Date(now.getTime() + 600_000),
      lastPolledAt: null,
      pollInterval: 5,
    };
    mocks.device.mockResolvedValue({ ...row, status: "pending" });
    expect(await exchangeDeviceCode("secret")).toEqual({
      error: "authorization_pending",
    });
    mocks.device.mockResolvedValue({ ...row, status: "denied" });
    expect(await exchangeDeviceCode("secret")).toEqual({
      error: "access_denied",
    });
    mocks.device.mockResolvedValue({
      ...row,
      expiresAt: now,
      status: "approved",
      authorization: grant(),
    });
    expect(await exchangeDeviceCode("secret")).toEqual({
      error: "expired_token",
    });
    expect(mocks.updateGrant).not.toHaveBeenCalled();
  });
  it("slows excessive polling and consumes an approved code exactly once", async () => {
    const row = {
      id: "code",
      status: "approved",
      expiresAt: new Date(now.getTime() + 600_000),
      lastPolledAt: new Date(now.getTime() - 1000),
      pollInterval: 5,
      authorization: grant(),
    };
    mocks.device.mockResolvedValue(row);
    expect(await exchangeDeviceCode("secret")).toEqual({ error: "slow_down" });
    row.lastPolledAt = new Date(now.getTime() - 10_000);
    mocks.updateDevice.mockImplementation(async ({ data }) => {
      if (data.status) row.status = data.status;
    });
    const issued = await exchangeDeviceCode("secret");
    expect(issued).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(mocks.updateGrant.mock.calls[0][0].data.tokenHash).toBe(
      secretHash(issued.access_token!),
    );
    expect(await exchangeDeviceCode("secret")).toEqual({
      error: "invalid_grant",
    });
    expect(mocks.updateGrant).toHaveBeenCalledOnce();
  });
  it("requires an active account for consent and rejects repeated approvals", async () => {
    mocks.device.mockResolvedValue({
      id: "code",
      status: "pending",
      clientName: "My Agent",
      expiresAt: new Date(now.getTime() + 600_000),
    });
    mocks.user.mockResolvedValue({ status: "BANNED", sessionVersion: 2 });
    await expect(
      decideDeviceAuthorization({
        userCode: "ABCD-EFGH",
        userId: "user-1",
        sessionVersion: 2,
        decision: "approve",
        mode: "timed",
        durationHours: 1,
      }),
    ).rejects.toThrow("账户不可用");
    expect(mocks.createGrant).not.toHaveBeenCalled();
    mocks.device.mockResolvedValue({
      status: "approved",
      expiresAt: new Date(now.getTime() + 600_000),
    });
    await expect(
      decideDeviceAuthorization({
        userCode: "ABCD-EFGH",
        userId: "user-1",
        sessionVersion: 2,
        decision: "approve",
      }),
    ).rejects.toThrow("已处理");
  });
});

describe("stale browser consent", () => {
  it("does not upgrade a revoked browser session to the latest account session version", async () => {
    mocks.device.mockResolvedValue({
      id: "code",
      status: "pending",
      clientName: "My Agent",
      expiresAt: new Date(now.getTime() + 600_000),
    });
    mocks.user.mockResolvedValue({ status: "ACTIVE", sessionVersion: 3 });
    await expect(
      decideDeviceAuthorization({
        userCode: "ABCD-EFGH",
        userId: "user-1",
        sessionVersion: 2,
        decision: "approve",
        mode: "timed",
        durationHours: 1,
      }),
    ).rejects.toThrow("登录状态已失效");
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });
});

describe("Agent bearer authentication", () => {
  const request = () =>
    new Request("https://chugao.art/api/v1/models", {
      headers: { Authorization: `Bearer cg_${"a".repeat(43)}` },
    });
  it("rejects browser cookies and invalid bearer values", async () => {
    await expect(
      requireAgent(
        new Request("https://chugao.art/api/v1/models", {
          headers: { Cookie: "session=example" },
        }),
      ),
    ).rejects.toThrow("授权");
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it.each([
    { revokedAt: now },
    { expiresAt: now },
    { user: { status: "BANNED", sessionVersion: 2 } },
    { sessionVersion: 1 },
  ])(
    "checks revocation, expiration, bans and session revocation on every call: %j",
    async (change) => {
      mocks.grant.mockResolvedValue(grant(change));
      await expect(requireAgent(request())).rejects.toThrow("已到期或已撤销");
    },
  );
  it("does not extend an authorization when used", async () => {
    mocks.grant.mockResolvedValue(grant());
    await requireAgent(request());
    expect(mocks.updateGrant).toHaveBeenCalledWith({
      where: { id: "grant-1" },
      data: { lastUsedAt: now },
    });
  });
});
