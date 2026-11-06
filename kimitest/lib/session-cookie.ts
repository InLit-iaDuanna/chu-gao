import { createHmac, timingSafeEqual } from "node:crypto";

import type { NextResponse } from "next/server";

import type { SessionUser } from "@/lib/auth";

export const SESSION_COOKIE_NAME = "chugao_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

interface SessionCookiePayload {
  sub: string;
  email: string;
  role: SessionUser["role"];
  status: SessionUser["status"];
  ver: number;
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

export function createSessionToken(user: SessionUser): string {
  const payload: SessionCookiePayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    ver: user.sessionVersion,
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

    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function readCookie(headers: Headers, name: string): string | undefined {
  const cookie = headers.get("cookie");

  if (!cookie) {
    return undefined;
  }

  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function attachSessionCookie<T>(
  response: NextResponse<T>,
  user: SessionUser,
): NextResponse<T> {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(user),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}

export function clearSessionCookie<T>(
  response: NextResponse<T>,
): NextResponse<T> {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
