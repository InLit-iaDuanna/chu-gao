import { createHmac, timingSafeEqual } from "node:crypto";

import type { NextResponse } from "next/server";

import type { SessionUser } from "@/lib/auth";
import {
  DEVICE_ID_COOKIE_NAME,
  isSessionDeviceType,
  isValidDeviceId,
  type SessionDeviceType,
} from "@/lib/session-device";

export const SESSION_COOKIE_NAME = "chugao_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEVICE_ID_TTL_SECONDS = 60 * 60 * 24 * 365;

export interface DeviceSessionCookieContext {
  deviceType: SessionDeviceType;
  deviceId: string;
  version: number;
}

export interface SessionCookiePayload {
  sub: string;
  email: string;
  role: SessionUser["role"];
  status: SessionUser["status"];
  ver: number;
  dvc: SessionDeviceType;
  did: string;
  dsv: number;
  exp: number;
}

function assertStrongProductionSecret(value: string, name: string): string {
  if (process.env.NODE_ENV !== "production") {
    return value;
  }

  if (value.length < 32 || value === "local-dev-secret") {
    throw new Error(`${name} must be at least 32 characters in production.`);
  }

  return value;
}

function secret(): string {
  const value =
    process.env.SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ENCRYPTION_KEY;

  if (value) {
    return assertStrongProductionSecret(
      value,
      "SESSION_SECRET/NEXTAUTH_SECRET/ENCRYPTION_KEY",
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET, NEXTAUTH_SECRET, or ENCRYPTION_KEY is required in production.",
    );
  }

  return "local-dev-secret";
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function sessionExpiresAt(now = Date.now()): Date {
  return new Date(now + SESSION_TTL_SECONDS * 1000);
}

export function createSessionToken(
  user: SessionUser,
  deviceSession: DeviceSessionCookieContext,
): string {
  const payload: SessionCookiePayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    ver: user.sessionVersion,
    dvc: deviceSession.deviceType,
    did: deviceSession.deviceId,
    dsv: deviceSession.version,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));

  return `${encoded}.${sign(encoded)}`;
}

export function parseSessionToken(
  token: string | undefined,
): SessionCookiePayload | null {
  if (!token) {
    return null;
  }

  const [encoded, signature] = token.split(".");

  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SessionCookiePayload;

    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      (payload.role !== "USER" && payload.role !== "ADMIN") ||
      (payload.status !== "ACTIVE" && payload.status !== "BANNED") ||
      !Number.isInteger(payload.ver) ||
      !isSessionDeviceType(payload.dvc) ||
      !isValidDeviceId(payload.did) ||
      !Number.isInteger(payload.dsv) ||
      payload.dsv < 1 ||
      !Number.isInteger(payload.exp) ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function readCookie(headers: Headers, name: string): string | undefined {
  return readCookieValues(headers, name).at(-1);
}

export function readCookieValues(headers: Headers, name: string): string[] {
  const cookie = headers.get("cookie");

  if (!cookie) {
    return [];
  }

  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
}

/**
 * Select a valid session when a browser still sends both a legacy host-only
 * cookie and the newer shared-domain cookie during migration.
 */
export function readSessionToken(headers: Headers): string | undefined {
  const values = readCookieValues(headers, SESSION_COOKIE_NAME);

  for (const value of values.reverse()) {
    if (parseSessionToken(value)) {
      return value;
    }
  }

  return undefined;
}

function appendLegacyHostSessionClear(response: NextResponse): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
  );
}

function sharedCookieDomain(): string | undefined {
  if (process.env.NODE_ENV !== "production") return undefined;
  const configured = process.env.SESSION_COOKIE_DOMAIN || ".chugao.art";
  const hostname = configured.replace(/^\./, "").toLowerCase();
  // Browsers treat IP/localhost cookies as host-only even with Domain. Clearing
  // a legacy host-only cookie there would delete the freshly issued session.
  if (
    hostname === "localhost" ||
    hostname.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  )
    return undefined;
  return configured;
}

export function attachSessionCookie<T>(
  response: NextResponse<T>,
  user: SessionUser,
  deviceSession: DeviceSessionCookieContext,
): NextResponse<T> {
  const domain = sharedCookieDomain();
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(user, deviceSession),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(domain ? { domain } : {}),
    maxAge: SESSION_TTL_SECONDS,
  });

  // Clear host-only cookies left by versions before sessions were shared
  // across chugao.art subdomains. Do this only in production, where the new
  // cookie has a Domain attribute; otherwise the clear would erase the fresh
  // localhost cookie too.
  if (domain) {
    appendLegacyHostSessionClear(response);
  }

  return response;
}

export function attachDeviceIdCookie<T>(
  response: NextResponse<T>,
  deviceId: string,
): NextResponse<T> {
  const domain = sharedCookieDomain();
  response.cookies.set({
    name: DEVICE_ID_COOKIE_NAME,
    value: deviceId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(domain ? { domain } : {}),
    maxAge: DEVICE_ID_TTL_SECONDS,
  });

  return response;
}

export function clearSessionCookie<T>(
  response: NextResponse<T>,
): NextResponse<T> {
  const domain = sharedCookieDomain();
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(domain ? { domain } : {}),
    maxAge: 0,
  });

  // Clear host-only cookies left by versions before the session became shared
  // across chugao.art subdomains.
  appendLegacyHostSessionClear(response);

  return response;
}
