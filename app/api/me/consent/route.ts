import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

const consentSchema = z.object({
  crossBorder: z.literal(true, {
    error: "需要同意将提示词与上传图片提供给境外模型服务商处理",
  }),
});

/**
 * 个人信息出境（境外模型服务商）的单独同意。
 * 只记录第一次同意的时间；重复调用不会覆盖已有时间。
 */
export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "账户服务未配置数据库", { status: 503 });
  }

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = consentSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "同意参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const session = authenticatedUser(sessionResult);

  try {
    await db.user.updateMany({
      where: { id: session.id, crossBorderConsentAt: null, deletedAt: null },
      data: { crossBorderConsentAt: new Date() },
    });

    const user = await db.user.findUnique({
      where: { id: session.id },
      select: { crossBorderConsentAt: true },
    });

    if (!user) {
      return fail("NOT_FOUND", "用户不存在", { status: 404 });
    }

    return ok({
      crossBorderConsentAt: user.crossBorderConsentAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "账户服务暂时不可用", { status: 503 });
    }

    throw error;
  }
}
