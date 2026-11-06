import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeProviderAccount } from "@/lib/providers/serialize";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; accountId: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id, accountId } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "号池服务未配置数据库", { status: 503 });
  }

  const current = await db.providerAccount.findFirst({
    where: { id: accountId, providerId: id },
    include: { provider: { select: { name: true } } },
  });

  if (!current) {
    return fail("NOT_FOUND", "账号不存在", { status: 404 });
  }

  const admin = authenticatedUser(sessionResult);
  const [account] = await db.$transaction([
    db.providerAccount.update({
      where: { id: accountId },
      data: {
        isActive: true,
        health: "HEALTHY",
        consecutiveErrors: 0,
        cooldownUntil: null,
      },
    }),
    // An active pool must not stay latched DOWN after its account is restored.
    // Deliberately disabled pools still require the explicit pool restore action.
    db.provider.updateMany({
      where: { id, isActive: true },
      data: { health: "HEALTHY", consecutiveErrors: 0 },
    }),
  ]);

  await audit({
    actorId: admin.id,
    action: "admin.provider_account.restore",
    target: accountId,
    diff: {
      isActive: true,
      health: "HEALTHY",
      consecutiveErrors: 0,
      cooldownUntil: null,
    },
    request,
  });

  return ok(
    serializeProviderAccount(account, {
      isDefault: account.name === `${current.provider.name} 默认账号`,
    }),
  );
}
