import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { cleanupExpiredData } from "@/lib/retention";

export const dynamic = "force-dynamic";

// 触发数据保留清理（聊天记录 / 生成图片 30 天）。
// 授权二选一：Authorization: Bearer <CRON_SECRET>（供外部定时任务），或管理员会话（手动）。
async function runCleanup(request: Request): Promise<Response> {
  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "保留服务未配置数据库", { status: 503 });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerOk = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  if (bearerOk) {
    const result = await cleanupExpiredData();
    return ok(result);
  }

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return fail("FORBIDDEN", "清理请求来源不合法", { status: 403 });
  }

  // 回退：管理员会话手动触发。
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少授权", { status: 401 });
  }

  const admin = authenticatedUser(sessionResult);
  const result = await cleanupExpiredData();

  await audit({
    actorId: admin.id,
    action: "admin.retention.cleanup",
    target: "retention",
    diff: result,
    request,
  });

  return ok(result);
}

export async function POST(request: Request) {
  return runCleanup(request);
}
