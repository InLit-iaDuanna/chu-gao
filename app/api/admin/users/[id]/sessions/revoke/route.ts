import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { adminRevokeSessionsSchema } from "@/lib/validators";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "用户服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);

  if (admin.id === id) {
    return fail("ADMIN_SELF_REVOKE", "不能强制下线当前管理员账号", {
      status: 400,
    });
  }

  const json = (await request.json().catch(() => ({}))) as unknown;
  const parsed = adminRevokeSessionsSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "强制下线参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const user = await db.user.update({
    where: { id },
    data: {
      sessionVersion: { increment: 1 },
    },
    select: {
      id: true,
      email: true,
      sessionVersion: true,
    },
  });

  await audit({
    actorId: admin.id,
    action: "admin.user.sessions_revoke",
    target: id,
    diff: { reason: parsed.data.reason, sessionVersion: user.sessionVersion },
    request,
  });

  return ok(user);
}
