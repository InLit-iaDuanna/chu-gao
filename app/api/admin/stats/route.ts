import { fail, ok } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { generationQueueStats } from "@/lib/queue";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "统计服务未配置数据库", { status: 503 });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      todayGenerations,
      onlineUsers,
      healthyProviders,
      queueDepth,
      running,
      failedToday,
      succeededToday,
      creditsToday,
      providerSlots,
      stuckGenerations,
      queueStatsResult,
    ] =
      await Promise.all([
        db.generation.count({
          where: { createdAt: { gte: today } },
        }),
        db.user.count({
          where: { status: "ACTIVE" },
        }),
        db.provider.count({
          where: { isActive: true, health: { not: "DOWN" } },
        }),
        db.generation.count({
          where: { status: "PENDING" },
        }),
        db.generation.count({
          where: { status: "RUNNING" },
        }),
        db.generation.count({
          where: { status: "FAILED", createdAt: { gte: today } },
        }),
        db.generation.count({
          where: { status: "SUCCEEDED", createdAt: { gte: today } },
        }),
        db.usageLog.aggregate({
          where: {
            createdAt: { gte: today },
            creditsDelta: { lt: 0 },
          },
          _sum: { creditsDelta: true },
        }),
        db.providerAccount.aggregate({
          where: {
            isActive: true,
            health: { not: "DOWN" },
          },
          _sum: {
            maxConcurrency: true,
            inFlight: true,
          },
        }),
        db.generation.count({
          where: {
            deletedAt: null,
            OR: [
              {
                status: "PENDING",
                createdAt: { lt: new Date(Date.now() - 2 * 60_000) },
              },
              {
                status: "RUNNING",
                startedAt: { lt: new Date(Date.now() - 10 * 60_000) },
              },
            ],
          },
        }),
        generationQueueStats().catch(() => null),
      ]);
    const queueStats = queueStatsResult ?? {
      waiting: queueDepth,
      active: running,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
      workerOnline: false,
      workerHeartbeatAt: null,
    };

    return ok({
      todayGenerations,
      onlineUsers,
      healthyProviders,
      queueDepth,
      running,
      failedToday,
      succeededToday,
      successRate:
        succeededToday + failedToday === 0
          ? 0
          : Math.round((succeededToday / (succeededToday + failedToday)) * 100),
      creditsToday: Math.abs(creditsToday._sum.creditsDelta ?? 0),
      accountSlots: providerSlots._sum.maxConcurrency ?? 0,
      accountInFlight: providerSlots._sum.inFlight ?? 0,
      queueWaiting: queueStats.waiting,
      queueActive: queueStats.active,
      queueDelayed: queueStats.delayed,
      queueFailed: queueStats.failed,
      queueCompleted: queueStats.completed,
      workerOnline: queueStats.workerOnline,
      workerHeartbeatAt: queueStats.workerHeartbeatAt,
      stuckGenerations,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "统计服务暂时不可用", { status: 503 });
    }

    return fail("INTERNAL_ERROR", "统计读取失败", {
      status: 500,
    });
  }
}
