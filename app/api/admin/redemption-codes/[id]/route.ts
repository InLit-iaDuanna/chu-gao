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

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "兑换码服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);
  const code = await db.creditRedemptionCode.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  await audit({
    actorId: admin.id,
    action: "admin.redemption_code.revoke",
    target: id,
    diff: { revokedAt: code.revokedAt },
    request,
  });

  return ok(code);
}
