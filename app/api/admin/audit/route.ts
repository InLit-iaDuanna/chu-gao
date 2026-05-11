import { fail, ok } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "审计服务未配置数据库", { status: 503 });
  }

  try {
    const rows = await db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return ok(rows);
  } catch (error) {
    return fail("INTERNAL_ERROR", "审计日志读取失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}
