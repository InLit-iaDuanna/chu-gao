import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/network";
import { redactSensitiveText } from "@/lib/providers/diagnostics";

function redactAuditValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /api[_-]?key|authorization|password|secret|token/i.test(key)
          ? "[redacted]"
          : redactAuditValue(item),
      ]),
    );
  }

  return value;
}

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
        diff: redactAuditValue(diff) as Prisma.InputJsonValue,
        ip: request ? getClientIp(request.headers) : null,
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
