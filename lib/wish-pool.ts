import { createHash, randomBytes } from "node:crypto";

import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readCookie } from "@/lib/session-cookie";

export const WISH_AUTHOR_COOKIE = "chugao_wish_author";
export const WISH_DAILY_LIMIT = 3;

export type WishIdentity = {
  token: string;
  tokenHash: string;
  ipHash: string;
  session: SessionUser | null;
};

function hash(value: string): string {
  const secret =
    process.env.WISH_POOL_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.ENCRYPTION_KEY ||
    "wish-pool-local-secret";
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    forwarded ||
    "unknown"
  );
}

export function wishIdentity(
  headers: Headers,
  session: SessionUser | null,
): WishIdentity {
  const existing = readCookie(headers, WISH_AUTHOR_COOKIE);
  const token = existing || randomBytes(24).toString("base64url");
  return {
    token,
    tokenHash: hash(token),
    ipHash: hash(clientIp(headers)),
    session,
  };
}

export function attachWishAuthorCookie<T extends Response>(
  response: T,
  identity: WishIdentity,
): T {
  if (!readCookie(response.headers, WISH_AUTHOR_COOKIE)) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
      "Set-Cookie",
      `${WISH_AUTHOR_COOKIE}=${identity.token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`,
    );
  }
  return response;
}

export function shanghaiDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function consumeWishQuota(ipHash: string): Promise<boolean> {
  const changed = await db.$executeRaw`
    INSERT INTO "WishDailyQuota" ("ipHash", "day", "count", "updatedAt")
    VALUES (${ipHash}, ${shanghaiDay()}, 1, NOW())
    ON CONFLICT ("ipHash", "day") DO UPDATE
      SET "count" = "WishDailyQuota"."count" + 1, "updatedAt" = NOW()
      WHERE "WishDailyQuota"."count" < ${WISH_DAILY_LIMIT}
  `;
  return changed === 1;
}

export async function remainingWishQuota(ipHash: string): Promise<number> {
  const row = await db.wishDailyQuota.findUnique({
    where: { ipHash_day: { ipHash, day: shanghaiDay() } },
    select: { count: true },
  });
  return Math.max(0, WISH_DAILY_LIMIT - (row?.count ?? 0));
}

export function canEditAuthor(
  record: { userId: string | null; authorKeyHash: string | null },
  identity: WishIdentity,
): boolean {
  if (identity.session?.role === "ADMIN") return true;
  if (record.userId && identity.session?.id === record.userId) return true;
  return !record.userId && record.authorKeyHash === identity.tokenHash;
}

export function publicAuthorName(
  requested: string | undefined,
  session: SessionUser | null,
): string {
  if (session?.role === "ADMIN") return "Chūgǎo 管理员";
  if (session) return session.email.split("@")[0].slice(0, 24);
  return requested?.trim().slice(0, 24) || "匿名访客";
}
