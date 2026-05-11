import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { attachSessionCookie } from "@/lib/session-cookie";
import {
  getRequiredSystemConfigValue,
  SystemConfigUnavailableError,
} from "@/lib/system-config";
import { registerSchema } from "@/lib/validators";

class InviteValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InviteValidationError";
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = registerSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "注册参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const { email, password, name, inviteCode } = parsed.data;
    const inviteOnly = await getRequiredSystemConfigValue(
      "registration.inviteOnly",
    );
    const defaultCredits = await getRequiredSystemConfigValue(
      "registration.defaultCredits",
    );

    if (inviteOnly && !inviteCode) {
      return fail("INVITE_REQUIRED", "当前注册需要邀请码", { status: 400 });
    }

    const existed = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existed) {
      return fail("VALIDATION_ERROR", "邮箱已被使用", { status: 409 });
    }

    let initialCredits: number = defaultCredits;
    let inviteRecordId: string | undefined;

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.$transaction(
      async (tx) => {
        if (inviteCode) {
          const inviteRecord = await tx.inviteCode.findUnique({
            where: { code: inviteCode },
            select: {
              id: true,
              initialCredits: true,
              usedCount: true,
              maxUses: true,
              revokedAt: true,
              expiresAt: true,
            },
          });

          if (!inviteRecord || inviteRecord.revokedAt) {
            throw new InviteValidationError("INVITE_INVALID", "邀请码无效");
          }

          if (inviteRecord.expiresAt && inviteRecord.expiresAt < new Date()) {
            throw new InviteValidationError("INVITE_INVALID", "邀请码已过期");
          }

          if (inviteRecord.usedCount >= inviteRecord.maxUses) {
            throw new InviteValidationError("INVITE_EXHAUSTED", "邀请码已用尽");
          }

          const claimed = await tx.inviteCode.updateMany({
            where: {
              id: inviteRecord.id,
              revokedAt: null,
              usedCount: {
                lt: inviteRecord.maxUses,
              },
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            data: {
              usedCount: {
                increment: 1,
              },
            },
          });

          if (claimed.count === 0) {
            throw new InviteValidationError("INVITE_EXHAUSTED", "邀请码已用尽");
          }

          initialCredits = inviteRecord.initialCredits;
          inviteRecordId = inviteRecord.id;
        }

        return tx.user.create({
          data: {
            email,
            name,
            passwordHash,
            credits: initialCredits,
            inviteCodeId: inviteRecordId,
          },
          select: {
            id: true,
            email: true,
            name: true,
            credits: true,
            role: true,
            status: true,
            sessionVersion: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const response = ok(user, { status: 201 });
    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      sessionVersion: user.sessionVersion,
    };

    return attachSessionCookie(response, sessionUser);
  } catch (error) {
    if (error instanceof InviteValidationError) {
      return fail(error.code, error.message, { status: 400 });
    }

    if (error instanceof SystemConfigUnavailableError) {
      return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return fail("VALIDATION_ERROR", "邮箱已被使用", { status: 409 });
    }

    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }
}
