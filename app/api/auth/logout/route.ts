import { fail, ok } from "@/lib/api-response";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  clearSessionCookie,
  parseSessionToken,
  readSessionToken,
} from "@/lib/session-cookie";

export async function POST(request: Request) {
  const payload = parseSessionToken(readSessionToken(request.headers));

  if (
    payload &&
    !process.env.DATABASE_URL &&
    process.env.NODE_ENV !== "development"
  ) {
    return fail("AUTH_UNAVAILABLE", "退出登录服务暂时不可用，请稍后重试", {
      status: 503,
    });
  }

  // Scope logout to the exact slot/version represented by this cookie. An
  // older device's delayed logout must never remove a newer login.
  if (payload && process.env.DATABASE_URL) {
    try {
      await db.deviceSession.updateMany({
        where: {
          userId: payload.sub,
          user: {
            sessionVersion: payload.ver,
          },
          deviceType: payload.dvc,
          deviceId: payload.did,
          version: payload.dsv,
        },
        data: {
          version: { increment: 1 },
          expiresAt: new Date(0),
        },
      });
    } catch (error) {
      logger.warn(
        { error, userId: payload.sub },
        "Could not revoke the server-side device session during logout.",
      );
      return fail("AUTH_UNAVAILABLE", "退出登录服务暂时不可用，请稍后重试", {
        status: 503,
      });
    }
  }

  return clearSessionCookie(ok({ loggedOut: true }));
}
