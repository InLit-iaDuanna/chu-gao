import { fail, ok } from "@/lib/api-response";
import { readJsonBodySafe } from "@/lib/request-body";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { adminCreditAdjustmentSchema } from "@/lib/validators";
import { adjustCreditsIdempotently } from "@/lib/chat-credit-ledger";

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

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const json = body.data;
  const parsed = adminCreditAdjustmentSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "点数参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const admin = authenticatedUser(sessionResult);
  let user;
  let replayed = false;

  try {
    const result = await db.$transaction((tx) =>
      adjustCreditsIdempotently(tx, {
        userId: id,
        actorId: admin.id,
        operationKey: parsed.data.operationKey,
        amount: parsed.data.amount,
        note: parsed.data.note,
      }),
    );
    user = result.user;
    replayed = result.replayed;
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
      return fail("IDEMPOTENCY_CONFLICT", "同一调额标识不能用于不同操作", {
        status: 409,
      });
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

  if (!replayed)
    await audit({
      actorId: admin.id,
      action:
        parsed.data.amount > 0
          ? "admin.user.recharge"
          : "admin.user.credit_adjust",
      target: id,
      diff: parsed.data,
      request,
    });

  return ok(user);
}
