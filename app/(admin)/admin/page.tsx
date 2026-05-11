import { headers } from "next/headers";

import { DashboardRecentControls } from "@/components/admin/AdminForms";
import { ProviderCard } from "@/components/admin/ProviderCard";
import { StatCard } from "@/components/admin/StatCard";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";

async function getDashboardData(recentLimit: number) {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
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
      creditsToday,
      slots,
      providers,
      generations,
    ] = await Promise.all([
      db.generation.count({ where: { createdAt: { gte: today } } }),
      db.user.count({ where: { status: "ACTIVE" } }),
      db.provider.count({ where: { isActive: true, health: { not: "DOWN" } } }),
      db.generation.count({ where: { status: "PENDING" } }),
      db.generation.count({ where: { status: "RUNNING" } }),
      db.generation.count({
        where: { status: "FAILED", createdAt: { gte: today } },
      }),
      db.usageLog.aggregate({
        where: { createdAt: { gte: today }, creditsDelta: { lt: 0 } },
        _sum: { creditsDelta: true },
      }),
      db.providerAccount.aggregate({
        where: { isActive: true, health: { not: "DOWN" } },
        _sum: { maxConcurrency: true, inFlight: true },
      }),
      db.provider.findMany({
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 4,
        include: { accounts: true },
      }),
      db.generation.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: recentLimit,
        select: {
          id: true,
          userId: true,
          prompt: true,
          status: true,
          modelId: true,
          costCredits: true,
          errorMessage: true,
          user: { select: { email: true } },
        },
      }),
    ]);

    return {
      stats: {
        todayGenerations,
        onlineUsers,
        healthyProviders,
        queueDepth,
        running,
        failedToday,
        creditsToday: Math.abs(creditsToday._sum.creditsDelta ?? 0),
        slots: `${slots._sum.inFlight ?? 0}/${slots._sum.maxConcurrency ?? 0}`,
      },
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        priority: provider.priority,
        health: provider.health,
        lastErrorMsg: provider.lastErrorMsg ?? "",
        modelsSupported: provider.modelsSupported,
        costMultiplier: provider.costMultiplier,
        accounts: provider.accounts.length,
        availableAccounts: provider.accounts.filter(
          (account) => account.isActive && account.health !== "DOWN",
        ).length,
      })),
      generations,
      trend: [0, 0, 0, 0, 0, 0, Math.max(8, todayGenerations)],
    };
  } catch {
    return null;
  }
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ recent?: string }>;
}) {
  const params = await searchParams;
  const requestedRecentLimit = Number(params?.recent ?? 20);
  const recentLimit =
    requestedRecentLimit === 100 ? 100 : requestedRecentLimit === 20 ? 20 : 20;
  const dashboardData = await getDashboardData(recentLimit);

  if (!dashboardData) {
    return (
      <div className="surface-panel p-6">
        <p className="eyebrow">仪表盘</p>
        <h1 className="mt-2 text-3xl font-semibold">运营数据暂不可用</h1>
        <p className="mt-4 text-sm leading-6 text-text-muted">
          请确认数据库服务已启动后再查看管理端数据。
        </p>
      </div>
    );
  }

  const { stats, providers, generations, trend } = dashboardData;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">仪表盘</p>
        <h1 className="mt-2 text-3xl font-semibold">运营总览</h1>
      </div>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="今日生成" value={stats.todayGenerations} />
        <StatCard label="在线用户" value={stats.onlineUsers} />
        <StatCard label="健康渠道" value={stats.healthyProviders} />
        <StatCard label="队列深度" value={stats.queueDepth} />
        <StatCard label="运行中" value={stats.running} />
        <StatCard label="今日失败" value={stats.failedToday} />
        <StatCard label="今日消耗" value={`${stats.creditsToday} 点`} />
        <StatCard label="号池占用" value={stats.slots} />
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="surface-panel p-4">
          <p className="text-sm text-text-muted">7 日趋势</p>
          <div className="mt-6 grid h-40 grid-cols-7 items-end gap-2">
            {trend.map((value, index) => (
              <div key={index} className="rounded-[6px] bg-surface-2 p-2">
                <div
                  className="rounded-[4px] bg-foreground/80"
                  style={{ height: `${value}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </section>
      <section className="surface-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-muted">最近 {recentLimit} 条生成</p>
          <DashboardRecentControls limit={recentLimit} />
        </div>
        <div className="mt-4 space-y-3">
          {generations.map((generation) => (
            <div
              key={generation.id}
              className="surface-panel-soft grid gap-2 px-4 py-3 text-sm lg:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className="min-w-0 truncate">{generation.prompt}</span>
              <span className="text-text-muted">
                {generation.user.email} · {generation.modelId} ·{" "}
                {generation.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
