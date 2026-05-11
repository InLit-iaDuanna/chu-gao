import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

const mePatchSchema = z.object({
  name: z.string().trim().min(1).max(40).nullable().optional(),
});

async function dailyUsedForUser(userId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return db.generation.count({
    where: {
      userId,
      createdAt: { gte: today },
      status: { not: "CANCELED" },
    },
  });
}

function accountServiceUnavailable() {
  return fail("SERVICE_UNAVAILABLE", "账户服务暂时不可用", { status: 503 });
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const session = authenticatedUser(sessionResult);

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "账户服务未配置数据库", { status: 503 });
  }

  try {
    const user = await db.user.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        credits: true,
        dailyGenLimit: true,
        concurrentLimit: true,
      },
    });

    if (!user) {
      return fail("NOT_FOUND", "用户不存在", { status: 404 });
    }

    const dailyUsed = await dailyUsedForUser(user.id);

    return ok({
      ...user,
      dailyUsed,
      dailyLimit: user.dailyGenLimit,
      authenticated: true,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return accountServiceUnavailable();
    }

    throw error;
  }
}

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const session = authenticatedUser(sessionResult);

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "账户服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = mePatchSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "用户资料参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const user = await db.user.update({
      where: { id: session.id },
      data: {
        name: parsed.data.name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        credits: true,
        dailyGenLimit: true,
        concurrentLimit: true,
      },
    });
    const dailyUsed = await dailyUsedForUser(user.id);

    return ok({
      ...user,
      dailyUsed,
      dailyLimit: user.dailyGenLimit,
      authenticated: true,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return accountServiceUnavailable();
    }

    throw error;
  }
}
