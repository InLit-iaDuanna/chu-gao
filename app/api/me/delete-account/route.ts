import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { checkUserActionRateLimit } from "@/lib/rate-limit";
import { readJsonBodySafe } from "@/lib/request-body";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import { clearSessionCookie } from "@/lib/session-cookie";

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
  confirmText: z.literal("注销", { error: "请输入“注销”两个字确认" }),
});

class DeleteAccountError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "DeleteAccountError";
  }
}

/**
 * 用户自助注销（APP 内合规要求）。
 *
 * 处理原则：
 * - 账号行保留（外键与审计需要），但匿名化并禁用：邮箱改写为 deleted-<id>@deleted.invalid，
 *   密码换成随机不可用摘要，资料清空，积分归零，status 变为不可登录，sessionVersion+1。
 * - 内容（对话、社区作品、API Key、Agent 授权、登录设备）删除或软删除。
 * - 订单与积分流水按法定保存要求保留。
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

  const parsed = deleteAccountSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "注销参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const session = authenticatedUser(sessionResult);

  const rateLimit = await checkUserActionRateLimit(
    session.id,
    "account-delete",
    5,
  );

  if (!rateLimit.allowed) {
    return fail("TOO_MANY_REQUESTS", "操作过于频繁，请稍后再试", {
      status: 429,
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  let deletedAt: Date;

  try {
    const user = await db.user.findUnique({
      where: { id: session.id },
      select: { id: true, passwordHash: true, role: true, deletedAt: true },
    });

    if (!user) {
      return fail("NOT_FOUND", "用户不存在", { status: 404 });
    }

    if (user.deletedAt) {
      return fail("ALREADY_DELETED", "账号已注销", { status: 409 });
    }

    if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return fail("FORBIDDEN", "密码不正确", { status: 403 });
    }

    const unusablePasswordHash = await bcrypt.hash(
      randomBytes(32).toString("hex"),
      12,
    );
    const now = new Date();

    await db.$transaction(
      async (tx) => {
        if (user.role === "ADMIN") {
          const otherAdmins = await tx.user.count({
            where: {
              role: "ADMIN",
              status: "ACTIVE",
              deletedAt: null,
              id: { not: user.id },
            },
          });

          if (otherAdmins === 0) {
            throw new DeleteAccountError(
              "LAST_ADMIN_LOCKOUT",
              "当前是唯一的管理员账号，请先移交管理员权限",
            );
          }
        }

        // 内容清理：对话（消息与 ChatTurn 级联删除）、社区作品（软删除）。
        await tx.conversation.deleteMany({ where: { userId: user.id } });
        await tx.designPost.updateMany({
          where: { authorId: user.id, deletedAt: null },
          data: { deletedAt: now, status: "HIDDEN" },
        });

        // 凭据与接入：API Key、Agent 授权、登录设备全部失效并删除。
        await tx.apiKey.deleteMany({ where: { userId: user.id } });
        await tx.agentAuthorization.deleteMany({ where: { userId: user.id } });
        await tx.deviceSession.deleteMany({ where: { userId: user.id } });

        // 账号本身匿名化：保留行以便订单、流水与审计外键继续有效。
        await tx.user.update({
          where: { id: user.id },
          data: {
            email: `deleted-${user.id}@deleted.invalid`,
            passwordHash: unusablePasswordHash,
            name: null,
            avatarKey: null,
            bio: null,
            designerTitle: null,
            designerLocation: null,
            designerWebsite: null,
            designDisciplines: [],
            credits: 0,
            status: "BANNED",
            bannedAt: now,
            bannedReason: "用户注销",
            deletedAt: now,
            sessionVersion: { increment: 1 },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    deletedAt = now;
  } catch (error) {
    if (error instanceof DeleteAccountError) {
      return fail(error.code, error.message, { status: error.status });
    }

    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "账户服务暂时不可用", { status: 503 });
    }

    throw error;
  }

  await audit({
    actorId: session.id,
    action: "user.account.delete",
    target: session.id,
    diff: { deletedAt: deletedAt.toISOString(), reason: "用户自助注销" },
    request,
  });

  return clearSessionCookie(
    ok({ deleted: true, deletedAt: deletedAt.toISOString() }),
  );
}
