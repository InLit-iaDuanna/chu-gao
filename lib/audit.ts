import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function audit({
  actorId,
  action,
  target,
  diff,
  request,
}: {
  actorId: string;
  action: string;
  target?: string;
  diff?: unknown;
  request?: Request;
}): Promise<void> {
  if (!process.env.DATABASE_URL) {
    return;
  }

  try {
    await db.auditLog.create({
      data: {
        actorId,
        action,
        target,
        diff: diff as Prisma.InputJsonValue,
        ip: request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        userAgent: request?.headers.get("user-agent"),
      },
    });
  } catch (error) {
    logger.warn(
      { error, actorId, action, target },
      "Failed to write audit log.",
    );
  }
}
