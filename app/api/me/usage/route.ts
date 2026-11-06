import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

function extractReason(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const reason = (metadata as Record<string, unknown>).reason;

  return typeof reason === "string" ? reason : null;
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "账户服务未配置数据库", {
      status: 503,
    });
  }

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 50)
      : 20;
    const cursor = searchParams.get("cursor");

    const rows = await db.usageLog.findMany({
      where: { userId: sessionResult.user.id },
      orderBy: { createdAt: "desc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
      select: {
        id: true,
        action: true,
        creditsDelta: true,
        modelId: true,
        generationId: true,
        metadata: true,
        createdAt: true,
      },
    });
    const items = rows.slice(0, limit);
    const generationIds = items.flatMap(row => row.generationId ? [row.generationId] : []);
    const sources = generationIds.length ? await db.usageLog.findMany({
      where: {userId: sessionResult.user.id, generationId: {in: generationIds}, action: "generate", metadata: {path: ["source"], equals: "agent"}},
      select: {generationId: true},
    }) : [];
    const agentIds = new Set(sources.map(row => row.generationId));

    return ok({
      items: items.map((row) => ({
        id: row.id,
        source: agentIds.has(row.generationId) ? "agent" : "web",
        action: row.action,
        creditsDelta: row.creditsDelta,
        modelId: row.modelId,
        generationId: row.generationId,
        reason: extractReason(row.metadata),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? (rows[limit]?.id ?? null) : null,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "账户服务暂时不可用", {
        status: 503,
      });
    }

    return fail("INTERNAL_ERROR", "积分流水读取失败", { status: 500 });
  }
}
