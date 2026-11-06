import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    deviceSession: {
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: mocks.warn,
  },
}));

import { POST } from "@/app/api/auth/logout/route";
import type { SessionUser } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session-cookie";

const user: SessionUser = {
  id: "user_123",
  email: "student@example.com",
  role: "USER",
  status: "ACTIVE",
  sessionVersion: 7,
};

const deviceSession = {
  deviceType: "WEB" as const,
  deviceId: "1A2b3C4d5E6f7G8h9I0j_k-lMnOpQrStUvWxYz12345",
  version: 4,
};

afterEach(() => {
  mocks.updateMany.mockReset();
  mocks.warn.mockReset();
  vi.unstubAllEnvs();
});

describe("logout device revocation", () => {
  it("matches both the device generation and the global session version", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/chugao");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const token = createSessionToken(user, deviceSession);
    const response = await POST(
      new Request("https://chugao.test/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        user: {
          sessionVersion: user.sessionVersion,
        },
        deviceType: deviceSession.deviceType,
        deviceId: deviceSession.deviceId,
        version: deviceSession.version,
      },
      data: {
        version: { increment: 1 },
        expiresAt: new Date(0),
      },
    });
  });
});
