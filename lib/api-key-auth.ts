import { createHash, randomBytes } from "node:crypto";
import type { ApiKey, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail } from "@/lib/api-response";

export const API_KEY_PREFIX = "cgapi_";
export const MAX_API_KEYS_PER_USER = 10;
// Increment on every throttle update to avoid stale write churn
const LAST_USED_UPDATE_INTERVAL_MS = 60_000;

export class ApiKeyError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

export function apiKeyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generate a new API key, returning both plaintext (show once) and its hash. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    key,
    hash: apiKeyHash(key),
    prefix: key.slice(0, API_KEY_PREFIX.length + 8),
  };
}

export type ApiKeyPrincipal = {
  apiKey: ApiKey;
  user: { id: string; email: string; credits: number };
};

function isActiveKey(
  key: Pick<ApiKey, "revokedAt" | "expiresAt">,
): boolean {
  if (key.revokedAt) return false;
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

/**
 * Authenticate a request using a cgapi_ Bearer token.
 * Throws ApiKeyError on any auth failure.
 */
export async function requireApiKey(request: Request): Promise<ApiKeyPrincipal> {
  const match = /^Bearer (cgapi_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) {
    throw new ApiKeyError("UNAUTHORIZED", "API key 无效或缺失");
  }

  const hash = apiKeyHash(match[1]);
  const record = await db.apiKey.findUnique({
    where: { keyHash: hash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          credits: true,
          status: true,
        },
      },
    },
  });

  if (!record) {
    throw new ApiKeyError("UNAUTHORIZED", "API key 不存在或已失效");
  }

  if (!isActiveKey(record)) {
    throw new ApiKeyError("UNAUTHORIZED", "API key 已过期或已撤销");
  }

  if (record.user.status !== "ACTIVE") {
    throw new ApiKeyError("UNAUTHORIZED", "账户不可用");
  }

  // Throttled last-used update — avoids write on every request
  if (
    !record.lastUsedAt ||
    Date.now() - record.lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS
  ) {
    await db.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {
      /* Non-fatal — don't fail the request if the write fails */
    });
  }

  return {
    apiKey: record,
    user: {
      id: record.user.id,
      email: record.user.email,
      credits: record.user.credits,
    },
  };
}

/**
 * Accept either an Agent Bearer token (cg_...) or an API key (cgapi_...).
 * Returns the resolved userId and apiKeyId (if applicable).
 */
export function detectAuthType(
  authHeader: string | null,
): "agent" | "apikey" | null {
  if (!authHeader) return null;
  const value = authHeader.replace(/^Bearer\s+/i, "");
  if (value.startsWith("cg_")) return "agent";
  if (value.startsWith(API_KEY_PREFIX)) return "apikey";
  return null;
}

export function apiKeyErrorResponse(error: unknown) {
  if (error instanceof ApiKeyError) {
    return fail(error.code, error.message, { status: error.status });
  }
  return fail("SERVICE_UNAVAILABLE", "API key 服务暂不可用", { status: 503 });
}

/**
 * Update the cumulative usedCredits on an API key.
 * Called after a generation is successfully enqueued.
 */
export async function recordApiKeyUsage(
  apiKeyId: string,
  credits: number,
): Promise<void> {
  await db.apiKey.update({
    where: { id: apiKeyId },
    data: { usedCredits: { increment: credits } },
  }).catch(() => {
    /* Non-fatal — credit tracking is best-effort */
  });
}
