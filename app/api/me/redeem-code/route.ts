import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { authenticatedUser, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { redeemCodeSchema } from "@/lib/validators";

class RedeemError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RedeemError";
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "兑换服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = redeemCodeSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "兑换码参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const session = authenticatedUser(sessionResult);

  try {
    const result = await db.$transaction(
      async (tx) => {
        const now = new Date();
        const code = await tx.creditRedemptionCode.findUnique({
          where: { code: parsed.data.code },
        });

        if (!code || code.revokedAt) {
          throw new RedeemError("REDEEM_INVALID", "兑换码无效");
        }

        if (code.expiresAt && code.expiresAt <= now) {
          throw new RedeemError("REDEEM_EXPIRED", "兑换码已过期");
        }

        const redeemed = await tx.creditRedemption.findUnique({
          where: {
            codeId_userId: {
              codeId: code.id,
              userId: session.id,
            },
          },
        });

        if (redeemed) {
          throw new RedeemError("REDEEM_ALREADY_USED", "你已兑换过该兑换码");
        }

        const claimed = await tx.creditRedemptionCode.updateMany({
          where: {
            id: code.id,
            revokedAt: null,
            usedCount: { lt: code.maxUses },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: {
            usedCount: {
              increment: 1,
            },
          },
        });

        if (claimed.count === 0) {
          throw new RedeemError("REDEEM_EXHAUSTED", "兑换码已用尽");
        }

        await tx.creditRedemption.create({
          data: {
            codeId: code.id,
            userId: session.id,
            credits: code.credits,
          },
        });

        const user = await tx.user.update({
          where: { id: session.id },
          data: {
            credits: {
              increment: code.credits,
            },
          },
          select: {
            id: true,
            credits: true,
          },
        });

        await tx.usageLog.create({
          data: {
            userId: session.id,
            action: "redeem_code",
            creditsDelta: code.credits,
            metadata: {
              codeId: code.id,
            },
          },
        });

        return {
          credits: code.credits,
          balance: user.credits,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return ok(result);
  } catch (error) {
    if (error instanceof RedeemError) {
      return fail(error.code, error.message, { status: error.status });
    }

    throw error;
  }
}
