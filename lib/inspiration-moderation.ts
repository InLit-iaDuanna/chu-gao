import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isPromptBlocked } from "@/lib/moderation";
import {
  assertModerationRejectionAllowed,
  recordModerationRejectionAttempt,
} from "@/lib/rate-limit";
import { wishIdentity } from "@/lib/wish-pool";

export type InspirationModerationSurface =
  | "POST_CREATE"
  | "POST_EDIT"
  | "COMMENT_CREATE"
  | "COMMENT_EDIT";

/**
 * Checks inspiration text and persists blocked attempts for both throttling and
 * moderation review. Persistence failures never turn a blocked submission into
 * an allowed one.
 */
export async function isInspirationTextBlocked({
  request,
  user,
  text,
  surface,
}: {
  request: Request;
  user: SessionUser;
  text: string;
  surface: InspirationModerationSurface;
}): Promise<boolean> {
  await assertModerationRejectionAllowed(user.id);
  if (!(await isPromptBlocked(text))) return false;

  const ipHash = wishIdentity(request.headers, user).ipHash;
  const results = await Promise.allSettled([
    recordModerationRejectionAttempt(user.id, undefined, {
      reason: "blocked_keyword",
      surface,
    }),
    db.moderationRejection.create({
      data: {
        userId: user.id,
        ip: ipHash,
        prompt: text,
        reason: `inspiration:${surface.toLowerCase()}:blocked_keyword`,
      },
    }),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn(
        { error: result.reason, userId: user.id, surface },
        "Failed to persist an inspiration moderation rejection",
      );
    }
  }

  return true;
}
