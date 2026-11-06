import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import {
  CLIENT_DEVICE_ID_HEADER,
  detectSessionDeviceType,
  DEVICE_ID_COOKIE_NAME,
  isValidDeviceId,
  type SessionDeviceType,
} from "@/lib/session-device";
import {
  readCookie,
  sessionExpiresAt,
  type DeviceSessionCookieContext,
} from "@/lib/session-cookie";

export interface RequestDeviceContext {
  deviceType: SessionDeviceType;
  deviceId: string;
  expiresAt: Date;
  userAgent: string | null;
}

function newDeviceId(): string {
  return randomBytes(32).toString("base64url");
}

export function requestDeviceContext(headers: Headers): RequestDeviceContext {
  const cookieDeviceId = readCookie(headers, DEVICE_ID_COOKIE_NAME);
  const bootstrapDeviceId = headers.get(CLIENT_DEVICE_ID_HEADER) ?? undefined;
  const deviceId = isValidDeviceId(cookieDeviceId)
    ? cookieDeviceId
    : isValidDeviceId(bootstrapDeviceId)
      ? bootstrapDeviceId
      : newDeviceId();

  return {
    deviceType: detectSessionDeviceType(headers),
    deviceId,
    expiresAt: sessionExpiresAt(),
    userAgent: headers.get("user-agent")?.slice(0, 2048) ?? null,
  };
}

/**
 * Atomically rotates exactly one device-type slot. Every credential login gets
 * a new generation so old tokens and delayed logout requests cannot affect the
 * replacement session.
 */
export async function rotateDeviceSession(
  userId: string,
  device: RequestDeviceContext,
): Promise<DeviceSessionCookieContext> {
  const session = await db.deviceSession.upsert({
    where: {
      userId_deviceType: {
        userId,
        deviceType: device.deviceType,
      },
    },
    create: {
      userId,
      deviceType: device.deviceType,
      deviceId: device.deviceId,
      version: 1,
      expiresAt: device.expiresAt,
      userAgent: device.userAgent,
    },
    update: {
      deviceId: device.deviceId,
      version: { increment: 1 },
      expiresAt: device.expiresAt,
      userAgent: device.userAgent,
    },
    select: { version: true },
  });

  return {
    deviceType: device.deviceType,
    deviceId: device.deviceId,
    version: session.version,
  };
}
