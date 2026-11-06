import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    deviceSession: {
      upsert: mocks.upsert,
    },
  },
}));

import {
  requestDeviceContext,
  rotateDeviceSession,
} from "@/lib/device-session";
import {
  CLIENT_DEVICE_ID_HEADER,
  DEVICE_ID_COOKIE_NAME,
  isValidDeviceId,
} from "@/lib/session-device";

beforeEach(() => {
  mocks.upsert.mockReset();
});

describe("requestDeviceContext", () => {
  it("reuses the persistent device id across pages in one browser", () => {
    const deviceId = "1A2b3C4d5E6f7G8h9I0j_k-lMnOpQrStUvWxYz12345";
    const context = requestDeviceContext(
      new Headers({
        cookie: `${DEVICE_ID_COOKIE_NAME}=${deviceId}`,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
    );

    expect(context.deviceType).toBe("WEB");
    expect(context.deviceId).toBe(deviceId);
  });

  it("creates a high-entropy id when this browser has none", () => {
    const context = requestDeviceContext(new Headers());

    expect(isValidDeviceId(context.deviceId)).toBe(true);
  });

  it("uses the bootstrap header only when there is no valid device cookie", () => {
    const cookieDeviceId =
      "CookieDeviceId1234567890_abcdefghijklmnopqrstuvwxyz";
    const headerDeviceId =
      "HeaderDeviceId1234567890_abcdefghijklmnopqrstuvwxyz";

    const bootstrapContext = requestDeviceContext(
      new Headers({ [CLIENT_DEVICE_ID_HEADER]: headerDeviceId }),
    );
    const cookieContext = requestDeviceContext(
      new Headers({
        cookie: `${DEVICE_ID_COOKIE_NAME}=${cookieDeviceId}`,
        [CLIENT_DEVICE_ID_HEADER]: headerDeviceId,
      }),
    );

    expect(bootstrapContext.deviceId).toBe(headerDeviceId);
    expect(cookieContext.deviceId).toBe(cookieDeviceId);
  });
});

describe("rotateDeviceSession", () => {
  it("upserts the slot, increments its version, and returns the stored version", async () => {
    mocks.upsert.mockResolvedValue({ version: 9 });
    const expiresAt = new Date("2026-09-03T00:00:00.000Z");
    const device = {
      deviceType: "WEB" as const,
      deviceId: "1A2b3C4d5E6f7G8h9I0j_k-lMnOpQrStUvWxYz12345",
      expiresAt,
      userAgent: "Desktop browser",
    };

    await expect(rotateDeviceSession("user_123", device)).resolves.toEqual({
      deviceType: "WEB",
      deviceId: device.deviceId,
      version: 9,
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: {
        userId_deviceType: {
          userId: "user_123",
          deviceType: "WEB",
        },
      },
      create: {
        userId: "user_123",
        deviceType: "WEB",
        deviceId: device.deviceId,
        version: 1,
        expiresAt,
        userAgent: "Desktop browser",
      },
      update: {
        deviceId: device.deviceId,
        version: { increment: 1 },
        expiresAt,
        userAgent: "Desktop browser",
      },
      select: { version: true },
    });
  });
});
