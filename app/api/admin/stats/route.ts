import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  channelIdFromProvider,
  displayNameForProviderChannel,
  normalizeProviderChannelBaseUrl,
} from "@/lib/provider-channels";
import { generationQueueStats } from "@/lib/queue";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

type DailyRow = {
  day: Date;
  total: bigint;
  succeeded: bigint;
  failed: bigint;
  credits: number | null;
};

type HourlyRow = {
  hour: Date;
  total: bigint;
  succeeded: bigint;
  failed: bigint;
};

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0);
}

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
    const since14Days = new Date(today);
    since14Days.setDate(since14Days.getDate() - 13);
    const since24Hours = new Date(Date.now() - 23 * 60 * 60_000);
    since24Hours.setMinutes(0, 0, 0);
    const since30Days = new Date(today);
    since30Days.setDate(since30Days.getDate() - 29);

    const [
      todayGenerations,
      onlineUsers,
      userCredits,
      healthyProviders,
      queueDepth,
      running,
      failedToday,
      succeededToday,
      creditsToday,
      providerSlots,
      stuckGenerations,
      queueStatsResult,
      dailyRows,
      hourlyRows,
      topUserRows,
      recentGenerations,
      errorRows,
      modelRows,
    ] = await Promise.all([
      db.generation.count({
        where: { createdAt: { gte: today } },
      }),
      db.user.count({
        where: { status: "ACTIVE" },
      }),
      db.user.aggregate({
        where: { role: "USER" },
        _sum: { credits: true },
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
      db.$queryRaw<DailyRow[]>(Prisma.sql`
        SELECT
          date_trunc('day', g."createdAt") AS day,
          count(*) AS total,
          count(*) FILTER (WHERE g."status" = 'SUCCEEDED') AS succeeded,
          count(*) FILTER (WHERE g."status" = 'FAILED') AS failed,
          COALESCE(sum(g."costCredits") FILTER (WHERE g."status" = 'SUCCEEDED'), 0)::float8 AS credits
        FROM "Generation" g
        WHERE g."createdAt" >= ${since14Days}
          AND g."deletedAt" IS NULL
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      db.$queryRaw<HourlyRow[]>(Prisma.sql`
        SELECT
          date_trunc('hour', g."createdAt") AS hour,
          count(*) AS total,
          count(*) FILTER (WHERE g."status" = 'SUCCEEDED') AS succeeded,
          count(*) FILTER (WHERE g."status" = 'FAILED') AS failed
        FROM "Generation" g
        WHERE g."createdAt" >= ${since24Hours}
          AND g."deletedAt" IS NULL
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      db.generation.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: since30Days }, deletedAt: null },
        _count: { id: true },
        _sum: { costCredits: true },
        orderBy: { _count: { id: "desc" } },
        take: 8,
      }),
      db.generation.findMany({
        where: { createdAt: { gte: since30Days }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 2000,
        select: {
          status: true,
          costCredits: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          provider: { select: { id: true, name: true } },
          providerAccount: {
            select: {
              baseUrl: true,
              provider: { select: { id: true, name: true } },
            },
          },
        },
      }),
      db.generation.groupBy({
        by: ["errorCode"],
        where: {
          createdAt: { gte: since30Days },
          deletedAt: null,
          status: "FAILED",
        },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 8,
      }),
      db.generation.groupBy({
        by: ["modelId"],
        where: { createdAt: { gte: since30Days }, deletedAt: null },
        _count: { id: true },
        _sum: { costCredits: true },
        orderBy: { _count: { id: "desc" } },
        take: 8,
      }),
    ]);
    const topUsers = topUserRows.length
      ? await db.user.findMany({
          where: { id: { in: topUserRows.map((row) => row.userId) } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const topUsersById = new Map(topUsers.map((user) => [user.id, user]));
    const providerStatsMap = new Map<
      string,
      {
        providerId: string | null;
        providerName: string;
        providerChannelId: string | null;
        total: number;
        succeeded: number;
        failed: number;
        credits: number;
        runMsTotal: number;
        runCount: number;
      }
    >();

    for (const generation of recentGenerations) {
      const accountProvider = generation.providerAccount?.provider;
      const normalizedBaseUrl = normalizeProviderChannelBaseUrl(
        generation.providerAccount?.baseUrl,
      );
      const providerId =
        accountProvider?.id ?? generation.provider?.id ?? "unknown";
      const providerName =
        accountProvider?.name ?? generation.provider?.name ?? "未知渠道";
      const providerChannelId =
        providerId !== "unknown" && normalizedBaseUrl
          ? channelIdFromProvider(providerId, normalizedBaseUrl)
          : null;
      const key = providerChannelId ?? providerId;
      const current = providerStatsMap.get(key) ?? {
        providerId: providerId === "unknown" ? null : providerId,
        providerName:
          displayNameForProviderChannel(normalizedBaseUrl, providerName) ??
          providerName,
        providerChannelId,
        total: 0,
        succeeded: 0,
        failed: 0,
        credits: 0,
        runMsTotal: 0,
        runCount: 0,
      };

      current.total += 1;
      if (generation.status === "SUCCEEDED") {
        current.succeeded += 1;
        current.credits += generation.costCredits;
      }
      if (generation.status === "FAILED") {
        current.failed += 1;
      }
      if (generation.startedAt && generation.finishedAt) {
        current.runMsTotal +=
          generation.finishedAt.getTime() - generation.startedAt.getTime();
        current.runCount += 1;
      }
      providerStatsMap.set(key, current);
    }
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
      userCredits: userCredits._sum.credits ?? 0,
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
      dailySeries: dailyRows.map((row) => ({
        date: row.day.toISOString().slice(0, 10),
        total: toNumber(row.total),
        succeeded: toNumber(row.succeeded),
        failed: toNumber(row.failed),
        credits: toNumber(row.credits),
      })),
      hourlySeries: hourlyRows.map((row) => ({
        hour: row.hour.toISOString(),
        total: toNumber(row.total),
        succeeded: toNumber(row.succeeded),
        failed: toNumber(row.failed),
      })),
      topUsers: topUserRows.map((row) => {
        const user = topUsersById.get(row.userId);

        return {
          userId: row.userId,
          email: user?.email ?? "未知用户",
          name: user?.name ?? null,
          generations: row._count.id,
          credits: row._sum.costCredits ?? 0,
        };
      }),
      providerStats: Array.from(providerStatsMap.values())
        .map((item) => ({
          providerId: item.providerId,
          providerName: item.providerName,
          providerChannelId: item.providerChannelId,
          total: item.total,
          succeeded: item.succeeded,
          failed: item.failed,
          successRate:
            item.succeeded + item.failed === 0
              ? 0
              : Math.round(
                  (item.succeeded / (item.succeeded + item.failed)) * 100,
                ),
          credits: item.credits,
          avgRunMs:
            item.runCount === 0
              ? null
              : Math.round(item.runMsTotal / item.runCount),
        }))
        .sort((left, right) => right.total - left.total)
        .slice(0, 8),
      errorBreakdown: errorRows.map((row) => ({
        code: row.errorCode ?? "UNKNOWN",
        count: row._count.id,
      })),
      modelUsage: modelRows.map((row) => ({
        modelId: row.modelId,
        generations: row._count.id,
        credits: row._sum.costCredits ?? 0,
      })),
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
