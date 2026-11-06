import { afterEach, describe, expect, it, vi } from "vitest";

import { checkSessionFromHeaders, devBypassSession } from "@/lib/auth";
import { DEVICE_ID_COOKIE_NAME } from "@/lib/session-device";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session-cookie";

const deviceSession = {
  deviceType: "WEB" as const,
  deviceId: "1A2b3C4d5E6f7G8h9I0j_k-lMnOpQrStUvWxYz12345",
  version: 1,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("development database bypass", () => {
  it("accepts the signed local development identity", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    const user = devBypassSession("student");

    expect(user).not.toBeNull();

    const token = createSessionToken(user!, deviceSession);
    const result = await checkSessionFromHeaders(
      new Headers({
        cookie: `${SESSION_COOKIE_NAME}=${token}; ${DEVICE_ID_COOKIE_NAME}=${deviceSession.deviceId}`,
      }),
    );

    expect(result).toEqual({ status: "authenticated", user });
  });

  it("still requires the matching device cookie", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    const user = devBypassSession("admin");

    expect(user).not.toBeNull();

    const token = createSessionToken(user!, deviceSession);
    const result = await checkSessionFromHeaders(
      new Headers({
        cookie: `${SESSION_COOKIE_NAME}=${token}; ${DEVICE_ID_COOKIE_NAME}=AnotherDeviceId1234567890_abcdefghijklmnop`,
      }),
    );

    expect(result).toEqual({ status: "unauthenticated" });
  });
});
