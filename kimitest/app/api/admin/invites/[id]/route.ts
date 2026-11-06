import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "邀请码服务未配置数据库", {
      status: 503,
    });
  }

  const admin = authenticatedUser(sessionResult);

  const invite = await db.inviteCode.findUnique({
    where: { id },
    select: {
      id: true,
      revokedAt: true,
    },
  });

  if (!invite) {
    return fail("NOT_FOUND", "邀请码不存在", { status: 404 });
  }

  const revoked = await db.inviteCode.update({
    where: { id },
    data: {
      revokedAt: invite.revokedAt ?? new Date(),
    },
  });

  await audit({
    actorId: admin.id,
    action: "admin.invite.revoke",
    target: id,
    diff: { revokedAt: revoked.revokedAt },
    request,
  });

  return ok(revoked);
}
