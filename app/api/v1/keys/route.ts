import { z } from "zod";
import { ok, fail } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  generateApiKey,
  MAX_API_KEYS_PER_USER,
} from "@/lib/api-key-auth";
import { readJsonBodySafe } from "@/lib/request-body";

export const runtime = "nodejs";

const createKeySchema = z.object({
  name: z.string().min(1).max(64),
  expiresAt: z.string().datetime().optional(),
});

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (sessionResult.status === "unauthenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });

  const userId = sessionResult.user.id;
  const keys = await db.apiKey.findMany({
    where: { userId, revokedAt: null },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      usedCredits: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return ok({ items: keys });
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (sessionResult.status === "unauthenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });

  const userId = sessionResult.user.id;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;

  const parsed = createKeySchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const existing = await db.apiKey.count({
    where: { userId, revokedAt: null },
  });
  if (existing >= MAX_API_KEYS_PER_USER) {
    return fail(
      "LIMIT_EXCEEDED",
      `每个账户最多创建 ${MAX_API_KEYS_PER_USER} 个 API key`,
      { status: 400 },
    );
  }

  const { key, hash, prefix } = generateApiKey();
  const expiresAt = parsed.data.expiresAt
    ? new Date(parsed.data.expiresAt)
    : null;

  const record = await db.apiKey.create({
    data: {
      userId,
      name: parsed.data.name,
      keyHash: hash,
      keyPrefix: prefix,
      ...(expiresAt ? { expiresAt } : {}),
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      usedCredits: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return ok(
    { ...record, key },
    { status: 201 },
  );
}
