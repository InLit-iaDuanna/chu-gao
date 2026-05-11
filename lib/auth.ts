import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  parseSessionToken,
  readCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/session-cookie";
import { fail } from "@/lib/api-response";

export interface SessionUser {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "BANNED";
  sessionVersion: number;
}

export type SessionCheckResult =
  | { status: "authenticated"; user: SessionUser }
  | { status: "unauthenticated" }
  | { status: "unavailable"; error: unknown };

export type AuthenticatedSessionCheckResult = Extract<
  SessionCheckResult,
  { status: "authenticated" }
>;

async function cookieSession(headers: Headers): Promise<SessionCheckResult> {
  const payload = parseSessionToken(readCookie(headers, SESSION_COOKIE_NAME));

  if (!payload) {
    return { status: "unauthenticated" };
  }

  if (!process.env.DATABASE_URL) {
    return {
      status: "unavailable",
      error: new Error("DATABASE_URL is required to validate cookie sessions."),
    };
  }

  try {
    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        sessionVersion: true,
      },
    });

    if (
      !user ||
      user.status !== "ACTIVE" ||
      user.sessionVersion !== payload.ver
    ) {
      return { status: "unauthenticated" };
    }

    return { status: "authenticated", user };
  } catch (error) {
    logger.error(
      { error },
      "Cookie session validation failed because the auth database is unavailable.",
    );
    return { status: "unavailable", error };
  }
}

export async function checkSessionFromHeaders(
  headers: Headers,
): Promise<SessionCheckResult> {
  return cookieSession(headers);
}

export async function checkSession(
  request: Request,
): Promise<SessionCheckResult> {
  return checkSessionFromHeaders(request.headers);
}

export async function requireSessionFromHeaders(
  headers: Headers,
): Promise<SessionUser | null> {
  const result = await checkSessionFromHeaders(headers);

  return result.status === "authenticated" ? result.user : null;
}

export async function requireSession(
  request: Request,
): Promise<SessionUser | null> {
  return requireSessionFromHeaders(request.headers);
}

export async function requireAdminSession(
  request: Request,
): Promise<SessionUser | null> {
  const session = await requireSession(request);

  if (!session || session.role !== "ADMIN" || session.status !== "ACTIVE") {
    return null;
  }

  return session;
}

export function sessionFailureResponse(result: SessionCheckResult) {
  if (result.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (result.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  return null;
}

export function authenticatedUser(result: SessionCheckResult): SessionUser {
  if (!isAuthenticatedSession(result)) {
    throw new Error("Session is not authenticated.");
  }

  return result.user;
}

export function isAuthenticatedSession(
  result: SessionCheckResult,
): result is AuthenticatedSessionCheckResult {
  return result.status === "authenticated";
}

export function adminFailureResponse(result: SessionCheckResult) {
  if (result.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (
    !isAuthenticatedSession(result) ||
    result.user.role !== "ADMIN" ||
    result.user.status !== "ACTIVE"
  ) {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  return null;
}

export async function requireAdminSessionFromHeaders(
  headers: Headers,
): Promise<SessionUser | null> {
  const session = await requireSessionFromHeaders(headers);

  if (!session || session.role !== "ADMIN" || session.status !== "ACTIVE") {
    return null;
  }

  return session;
}
