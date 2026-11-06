import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";

import { DashboardGenerationFilters } from "@/components/admin/DashboardAdminControls";
import { GenerationRecordList } from "@/components/admin/GenerationRecordList";
import { ProviderCard } from "@/components/admin/ProviderCard";
import { StatCard } from "@/components/admin/StatCard";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { generationQueueStats } from "@/lib/queue";

interface TrendDay {
  key: string;
  label: string;
  weekday: string;
  count: number;
  isToday: boolean;
}

function localDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 近 7 天（含今天）的逐日生成量。按服务器时区把 UTC 时间戳折算成本地日，
// 与页面其它「今日」统计使用同一套日边界。
async function getDailyTrend(todayStart: Date): Promise<TrendDay[]> {
  const rangeStart = new Date(todayStart);
  rangeStart.setDate(rangeStart.getDate() - 6);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const rows = await db.$queryRaw<Array<{ day: string; n: number }>>`
    SELECT
      to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
      count(*)::int AS n
    FROM "Generation"
    WHERE "createdAt" >= ${rangeStart} AND "deletedAt" IS NULL
    GROUP BY 1
  `;
  const countsByDay = new Map(rows.map((row) => [row.day, row.n]));

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(todayStart);
    date.setDate(date.getDate() - 6 + index);
    const key = localDayKey(date);

    return {
      key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      weekday: date.toLocaleDateString("zh-CN", { weekday: "short" }),
      count: countsByDay.get(key) ?? 0,
      isToday: index === 6,
    };
  });
}

const GENERATION_FILTER_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const;
const DASHBOARD_GENERATION_LIMIT = 24;

interface GenerationFilters {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}

function dateBoundary(value: string | undefined, nextDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  if (nextDay) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;
}

function generationFilterWhere(
  filters: GenerationFilters,
): Prisma.GenerationWhereInput {
  const q = filters.q?.trim();
  const from = dateBoundary(filters.from);
  const to = dateBoundary(filters.to, true);
  const status = GENERATION_FILTER_STATUSES.find(
    (value) => value === filters.status,
  );

  return {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lt: to } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { prompt: { contains: q, mode: "insensitive" } },
            {
              user: {
                OR: [
                  { email: { contains: q, mode: "insensitive" } },
                  { name: { contains: q, mode: "insensitive" } },
                ],
              },
            },
          ],
        }
      : {}),
  };
}

async function getDashboardData(filters: GenerationFilters) {
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
      userCredits,
      healthyProviders,
      queueDepth,
      running,
      failedToday,
      creditsToday,
      slots,
      stuckGenerations,
      queueStatsResult,
      providers,
      generations,
      generationTotal,
      dailyTrend,
    ] = await Promise.all([
      db.generation.count({ where: { createdAt: { gte: today } } }),
      db.user.count({ where: { status: "ACTIVE" } }),
      db.user.aggregate({
        where: { role: "USER" },
        _sum: { credits: true },
      }),
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
      db.provider.findMany({
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 4,
        include: { accounts: true },
      }),
      db.generation.findMany({
        where: generationFilterWhere(filters),
        orderBy: { createdAt: "desc" },
        take: DASHBOARD_GENERATION_LIMIT,
        select: {
          id: true,
          userId: true,
          prompt: true,
          status: true,
          modelId: true,
          costCredits: true,
          attempts: true,
          errorMessage: true,
          errorCode: true,
          progress: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          providerId: true,
          providerAccountId: true,
          user: { select: { email: true } },
          provider: { select: { name: true } },
          providerAccount: { select: { name: true, baseUrl: true } },
          images: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              width: true,
              height: true,
              sizeBytes: true,
              mimeType: true,
              createdAt: true,
            },
          },
        },
      }),
      db.generation.count({ where: generationFilterWhere(filters) }),
      getDailyTrend(today),
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

    return {
      stats: {
        todayGenerations,
        onlineUsers,
        userCredits: userCredits._sum.credits ?? 0,
        healthyProviders,
        queueDepth,
        running,
        failedToday,
        creditsToday: Math.abs(creditsToday._sum.creditsDelta ?? 0),
        slots: `${slots._sum.inFlight ?? 0}/${slots._sum.maxConcurrency ?? 0}`,
        queueWaiting: queueStats.waiting,
        queueActive: queueStats.active,
        queueFailed: queueStats.failed,
        workerOnline: queueStats.workerOnline,
        workerHeartbeatAt: queueStats.workerHeartbeatAt,
        stuckGenerations,
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
        inFlight: provider.accounts.reduce(
          (sum, account) => sum + account.inFlight,
          0,
        ),
        maxConcurrency: provider.accounts.reduce(
          (sum, account) => sum + account.maxConcurrency,
          0,
        ),
      })),
      generations,
      generationTotal,
      trend: dailyTrend,
    };
  } catch {
    return null;
  }
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<GenerationFilters>;
}) {
  const params = await searchParams;
  const filters: GenerationFilters = {
    q: params?.q,
    status: params?.status,
    from: params?.from,
    to: params?.to,
  };
  const dashboardData = await getDashboardData(filters);

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

  const { stats, providers, generations, generationTotal, trend } =
    dashboardData;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">仪表盘</p>
        <h1 className="mt-2 text-3xl font-semibold">运营总览</h1>
      </div>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="今日生成" value={stats.todayGenerations} />
        <StatCard label="在线用户" value={stats.onlineUsers} />
        <StatCard
          label="普通用户余额"
          value={`${stats.userCredits.toLocaleString("zh-CN", {
            maximumFractionDigits: 1,
          })} 点`}
        />
        <StatCard label="健康渠道" value={stats.healthyProviders} />
        <StatCard label="队列深度" value={stats.queueDepth} />
        <StatCard label="运行中" value={stats.running} />
        <StatCard label="今日失败" value={stats.failedToday} />
        <StatCard label="今日消耗" value={`${stats.creditsToday} 点`} />
        <StatCard label="号池占用" value={stats.slots} />
        <StatCard
          label="生成服务"
          value={stats.workerOnline ? "在线" : "离线"}
        />
        <StatCard label="Redis 等待" value={stats.queueWaiting} />
        <StatCard label="Redis 活跃" value={stats.queueActive} />
        <StatCard label="疑似卡单" value={stats.stuckGenerations} />
      </section>
      {!stats.workerOnline ? (
        <section className="surface-panel border-warning/40 p-4">
          <p className="text-sm font-medium text-warning">生成 worker 未在线</p>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            当前只启动 UI 时，任务会停留在排队中。请使用 pnpm
            dev:all，或另开终端运行 pnpm worker。
          </p>
        </section>
      ) : null}
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="surface-panel p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-text-muted">近 7 日生成量</p>
            <p className="font-mono text-xs tabular-nums text-text-faint">
              共 {trend.reduce((sum, day) => sum + day.count, 0)} 次
            </p>
          </div>
          {/* 单序列柱状图：高度编码数值，今天用品牌色强调，历史日用同色淡阶。 */}
          <div className="mt-6 grid h-40 grid-cols-7 items-end gap-2 border-b border-border">
            {(() => {
              const max = Math.max(...trend.map((day) => day.count), 1);
              const labeledCounts = new Set([
                Math.max(...trend.map((day) => day.count)),
              ]);
              return trend.map((day) => {
                const showLabel =
                  day.count > 0 &&
                  (day.isToday || labeledCounts.has(day.count));
                return (
                  <div
                    key={day.key}
                    className="group flex h-full flex-col items-center justify-end gap-1.5"
                    title={`${day.label}（${day.weekday}）：${day.count} 次生成`}
                  >
                    <span
                      className={`font-mono text-[10px] leading-none tabular-nums text-text-muted transition-opacity ${
                        showLabel ? "" : "opacity-0 group-hover:opacity-100"
                      }`}
                      aria-hidden
                    >
                      {day.count}
                    </span>
                    <div
                      className="w-full max-w-[24px] rounded-t-[4px]"
                      style={{
                        height: `max(${(day.count / max) * 100}%, 2px)`,
                        backgroundColor: day.isToday
                          ? "rgb(var(--brand-primary))"
                          : "rgb(var(--brand-primary) / 0.35)",
                      }}
                    />
                  </div>
                );
              });
            })()}
          </div>
          <div className="mt-1.5 grid grid-cols-7 gap-2 text-center">
            {trend.map((day) => (
              <span
                key={day.key}
                className={`text-[10px] leading-none ${
                  day.isToday
                    ? "font-medium text-foreground"
                    : "text-text-faint"
                }`}
                aria-hidden
              >
                {day.isToday ? "今天" : day.label}
              </span>
            ))}
          </div>
          {trend.every((day) => day.count === 0) ? (
            <p className="mt-3 text-xs text-text-faint">
              近 7 日暂无生成记录。
            </p>
          ) : null}
          {/* 屏幕阅读器用的数据表视图 */}
          <table className="sr-only">
            <caption>近 7 日每日生成量</caption>
            <thead>
              <tr>
                <th scope="col">日期</th>
                <th scope="col">生成次数</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((day) => (
                <tr key={day.key}>
                  <th scope="row">
                    {day.label}（{day.weekday}）
                  </th>
                  <td>{day.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </section>
      <section className="surface-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">生成记录</p>
            <p className="mt-1 text-xs text-text-muted">
              匹配 {generationTotal} 条，当前显示前 {DASHBOARD_GENERATION_LIMIT}{" "}
              条
            </p>
          </div>
          <Link
            href={{
              pathname: "/admin/generations",
              query: Object.fromEntries(
                Object.entries(filters).filter(([, value]) => Boolean(value)),
              ),
            }}
            className="tool-button h-9 text-xs text-text-muted"
          >
            查看全部记录
          </Link>
        </div>
        <div className="mt-4">
          <DashboardGenerationFilters {...filters} />
        </div>
        <div className="mt-4">
          <GenerationRecordList generations={generations} compact />
        </div>
      </section>
    </div>
  );
}
