import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { removeGenerationJob } from "@/lib/queue";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", { status: 503 });
  }

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  try {
    const session = sessionResult.user;
    const generation = await db.generation.findFirst({
      where: {
        id,
        userId: session.id,
        deletedAt: null,
      },
    });

    if (!generation) {
      return fail("NOT_FOUND", "任务不存在", { status: 404 });
    }

    const canceled = await db.$transaction(async (tx) => {
      const charged = await tx.usageLog.aggregate({
        where: {
          generationId: generation.id,
          action: "generate",
        },
        _sum: {
          creditsDelta: true,
        },
      });
      const alreadyRefunded = await tx.usageLog.aggregate({
        where: {
          generationId: generation.id,
          action: "refund",
        },
        _sum: {
          creditsDelta: true,
        },
      });
      const debitedCredits = Math.max(0, -(charged._sum.creditsDelta ?? 0));
      const refundedCredits = Math.max(
        0,
        alreadyRefunded._sum.creditsDelta ?? 0,
      );
      const refundableCredits = Math.max(0, debitedCredits - refundedCredits);

      const updated = await tx.generation.updateMany({
        where: {
          id,
          userId: session.id,
          deletedAt: null,
          status: "PENDING",
        },
        data: {
          status: "CANCELED",
          finishedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        return false;
      }

      if (refundableCredits > 0) {
        await tx.user.update({
          where: { id: session.id },
          data: {
            credits: {
              increment: refundableCredits,
            },
          },
        });

        await tx.usageLog.create({
          data: {
            userId: session.id,
            generationId: generation.id,
            modelId: generation.modelId,
            action: "refund",
            creditsDelta: refundableCredits,
            metadata: {
              reason: "canceled",
            },
          },
        });
      }

      return true;
    });

    if (!canceled) {
      return fail("VALIDATION_ERROR", "只有排队中的任务可以取消", {
        status: 409,
      });
    }

    if (generation.jobId) {
      try {
        await removeGenerationJob(generation.jobId);
      } catch {
        // The DB status is the source of truth; the worker also skips non-pending jobs.
      }
    }

    return ok({
      status: "CANCELED",
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "生成服务暂时不可用", { status: 503 });
    }

    throw error;
  }
}
