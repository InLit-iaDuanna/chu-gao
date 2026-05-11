import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { adminCreditAdjustmentSchema } from "@/lib/validators";

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
    return fail("SERVICE_UNAVAILABLE", "点数服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = adminCreditAdjustmentSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "点数参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const admin = authenticatedUser(sessionResult);
  let user;

  try {
    user = await db.$transaction(
      async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id },
        select: { id: true, credits: true },
      });

      if (!existing) {
        throw new Error("NOT_FOUND");
      }

      if (existing.credits + parsed.data.amount < 0) {
        throw new Error("NEGATIVE_BALANCE");
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          credits: {
            increment: parsed.data.amount,
          },
        },
        select: {
          id: true,
          email: true,
          credits: true,
        },
      });

      await tx.usageLog.create({
        data: {
          userId: id,
          action:
            parsed.data.amount > 0 ? "admin_credit_recharge" : "admin_credit_adjust",
          creditsDelta: parsed.data.amount,
          metadata: {
            adminId: admin.id,
            note: parsed.data.note,
          },
        },
      });

      return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return fail("NOT_FOUND", "用户不存在", { status: 404 });
    }

    if (error instanceof Error && error.message === "NEGATIVE_BALANCE") {
      return fail("NEGATIVE_BALANCE", "用户余额不能扣成负数", {
        status: 400,
      });
    }

    throw error;
  }

  if (!user) {
    return fail("NOT_FOUND", "用户不存在", { status: 404 });
  }

  await audit({
    actorId: admin.id,
    action:
      parsed.data.amount > 0 ? "admin.user.recharge" : "admin.user.credit_adjust",
    target: id,
    diff: parsed.data,
    request,
  });

  return ok(user);
}
