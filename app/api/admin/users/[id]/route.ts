import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import { adminUserPatchSchema } from "@/lib/validators";

class AdminSafetyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AdminSafetyError";
  }
}

async function assertAdminMutationSafe(
  tx: Prisma.TransactionClient,
  actorId: string,
  target: { id: string; role: "USER" | "ADMIN"; status: "ACTIVE" | "BANNED" },
  next: { role?: "USER" | "ADMIN"; status?: "ACTIVE" | "BANNED" },
) {
  const nextRole = next.role ?? target.role;
  const nextStatus = next.status ?? target.status;
  const disablesTargetAdmin =
    target.role === "ADMIN" &&
    target.status === "ACTIVE" &&
    (nextRole !== "ADMIN" || nextStatus !== "ACTIVE");

  if (
    target.id === actorId &&
    (nextRole !== "ADMIN" || nextStatus !== "ACTIVE")
  ) {
    throw new AdminSafetyError(
      "ADMIN_SELF_LOCKOUT",
      "不能禁用或降级当前管理员账号",
    );
  }

  if (!disablesTargetAdmin) {
    return;
  }

  const activeAdminCount = await tx.user.count({
    where: {
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  if (activeAdminCount <= 1) {
    throw new AdminSafetyError(
      "LAST_ADMIN_LOCKOUT",
      "不能禁用或降级最后一个管理员账号",
    );
  }
}

export async function GET(
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
    return fail("SERVICE_UNAVAILABLE", "用户服务未配置数据库", { status: 503 });
  }

  try {
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        sessionVersion: true,
        credits: true,
        dailyGenLimit: true,
        concurrentLimit: true,
        bannedAt: true,
        bannedReason: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            generations: true,
          },
        },
      },
    });

    if (!user) {
      return fail("NOT_FOUND", "用户不存在", { status: 404 });
    }

    return ok(user);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "用户服务暂时不可用", { status: 503 });
    }

    throw error;
  }
}

export async function PATCH(
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
    return fail("SERVICE_UNAVAILABLE", "用户服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = adminUserPatchSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "用户参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const admin = authenticatedUser(sessionResult);
  let user;

  try {
    user = await db.$transaction(
      async (tx) => {
        const before = await tx.user.findUnique({
          where: { id },
        });

        if (!before) {
          throw new AdminSafetyError("NOT_FOUND", "用户不存在", 404);
        }

        await assertAdminMutationSafe(tx, admin.id, before, parsed.data);

        const nextStatus = parsed.data.status;
        const invalidatesSession = Boolean(
          parsed.data.email ||
            parsed.data.role ||
            parsed.data.status ||
            parsed.data.bannedReason,
        );

        return tx.user.update({
          where: { id },
          data: {
            email: parsed.data.email,
            name: parsed.data.name,
            role: parsed.data.role,
            status: nextStatus,
            dailyGenLimit: parsed.data.dailyGenLimit,
            concurrentLimit: parsed.data.concurrentLimit,
            sessionVersion: invalidatesSession
              ? { increment: 1 }
              : undefined,
            bannedReason: parsed.data.bannedReason,
            bannedAt:
              nextStatus === "BANNED"
                ? (before.bannedAt ?? new Date())
                : nextStatus === "ACTIVE"
                  ? null
                  : undefined,
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            sessionVersion: true,
            credits: true,
            dailyGenLimit: true,
            concurrentLimit: true,
            bannedAt: true,
            bannedReason: true,
            updatedAt: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof AdminSafetyError) {
      return fail(error.code, error.message, { status: error.status });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return fail("EMAIL_TAKEN", "邮箱已被使用", { status: 409 });
    }

    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "用户服务暂时不可用", { status: 503 });
    }

    throw error;
  }

  await audit({
    actorId: admin.id,
    action: "admin.user.update",
    target: id,
    diff: parsed.data,
    request,
  });

  return ok(user);
}

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
    return fail("SERVICE_UNAVAILABLE", "用户服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);
  let user;

  try {
    user = await db.$transaction(
      async (tx) => {
        const before = await tx.user.findUnique({
          where: { id },
        });

        if (!before) {
          throw new AdminSafetyError("NOT_FOUND", "用户不存在", 404);
        }

        await assertAdminMutationSafe(tx, admin.id, before, {
          status: "BANNED",
        });

        return tx.user.update({
          where: { id },
          data: {
            status: "BANNED",
            sessionVersion: { increment: 1 },
            bannedAt: new Date(),
            bannedReason: "admin_delete",
          },
          select: {
            id: true,
            status: true,
            bannedAt: true,
            bannedReason: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof AdminSafetyError) {
      return fail(error.code, error.message, { status: error.status });
    }

    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "用户服务暂时不可用", { status: 503 });
    }

    throw error;
  }

  await audit({
    actorId: admin.id,
    action: "admin.user.ban",
    target: id,
    diff: { status: "BANNED", bannedReason: "admin_delete" },
    request,
  });

  return ok(user);
}
