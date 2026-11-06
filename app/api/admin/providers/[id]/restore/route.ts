import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeProvider } from "@/lib/providers/serialize";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  if (!process.env.DATABASE_URL)
    return fail("SERVICE_UNAVAILABLE", "渠道服务未配置数据库", { status: 503 });

  const { id } = await context.params;
  const current = await db.provider.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!current) return fail("NOT_FOUND", "渠道不存在", { status: 404 });

  const provider = await db.$transaction(async (tx) => {
    await tx.provider.update({
      where: { id },
      data: { isActive: true, health: "HEALTHY", consecutiveErrors: 0 },
    });
    await tx.providerAccount.updateMany({
      where: { providerId: id },
      data: {
        isActive: true,
        health: "HEALTHY",
        consecutiveErrors: 0,
        cooldownUntil: null,
      },
    });
    return tx.provider.findUniqueOrThrow({
      where: { id },
      include: { accounts: true },
    });
  });

  await audit({
    actorId: authenticatedUser(session).id,
    action: "admin.provider.restore",
    target: id,
    diff: {
      isActive: true,
      health: "HEALTHY",
      consecutiveErrors: 0,
      restoredAccounts: provider.accounts.length,
    },
    request,
  });
  return ok(serializeProvider(provider));
}
