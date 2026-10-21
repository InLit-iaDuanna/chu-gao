import { ok, fail } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (sessionResult.status === "unauthenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });

  const userId = sessionResult.user.id;
  const { id } = await context.params;

  const key = await db.apiKey.findUnique({
    where: { id },
    select: { userId: true, revokedAt: true },
  });

  if (!key || key.userId !== userId) {
    return fail("NOT_FOUND", "API key 不存在", { status: 404 });
  }

  if (key.revokedAt) {
    return fail("ALREADY_REVOKED", "该 API key 已撤销", { status: 409 });
  }

  await db.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  return ok({ revoked: true });
}
