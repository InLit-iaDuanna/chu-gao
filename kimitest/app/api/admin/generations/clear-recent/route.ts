import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    limit?: unknown;
  };
  const limit = Math.min(Math.max(Number(payload.limit ?? 20), 1), 100);
  const rows = await db.generation.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });

  if (rows.length === 0) {
    return ok({ cleared: 0 });
  }

  const cleared = await db.generation.updateMany({
    where: {
      id: { in: rows.map((row) => row.id) },
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });
  const admin = authenticatedUser(sessionResult);

  await audit({
    actorId: admin.id,
    action: "admin.generations.clear_recent",
    target: rows.map((row) => row.id).join(","),
    diff: { limit, cleared: cleared.count },
    request,
  });

  return ok({ cleared: cleared.count });
}
