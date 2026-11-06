"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Coins,
  Image as ImageIcon,
  RefreshCw,
  Server,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui";
import { cn, formatDate } from "@/lib/utils";

import { getAdminStats } from "./lib/api";
import type { AdminStats } from "./lib/types";
import { AdminPageHeader, EmptyPanel } from "./ui";

type DailyPoint = AdminStats["dailySeries"][number];
type HourlyPoint = AdminStats["hourlySeries"][number];
type Tone = "default" | "success" | "warning" | "danger";

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDailySeries(
  rows: AdminStats["dailySeries"],
  days = 14,
  now = new Date(),
): AdminStats["dailySeries"] {
  if (days <= 0) return [];
  const rowsByDate = new Map(rows.map((row) => [row.date, row]));
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - days + 1);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + index);
    const key = localDateKey(date);
    const row = rowsByDate.get(key);
    return {
      date: key,
      total: row?.total ?? 0,
      succeeded: row?.succeeded ?? 0,
      failed: row?.failed ?? 0,
      credits: row?.credits ?? 0,
    };
  });
}

export function normalizeHourlySeries(
  rows: AdminStats["hourlySeries"],
  hours = 24,
  now = new Date(),
): AdminStats["hourlySeries"] {
  if (hours <= 0) return [];
  const rowsByHour = new Map<number, HourlyPoint>();
  for (const row of rows) {
    const hour = new Date(row.hour);
    hour.setMinutes(0, 0, 0);
    rowsByHour.set(hour.getTime(), row);
  }
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  return Array.from({ length: hours }, (_, index) => {
    const hour = new Date(end.getTime() - (hours - index - 1) * 3_600_000);
    const row = rowsByHour.get(hour.getTime());
    return {
      hour: hour.toISOString(),
      total: row?.total ?? 0,
      succeeded: row?.succeeded ?? 0,
      failed: row?.failed ?? 0,
    };
  });
}

export function chartPoints(
  values: number[],
  width: number,
  height: number,
  sharedMaximum?: number,
) {
  if (values.length === 0) return [];
  const max = Math.max(1, sharedMaximum ?? Math.max(...values));
  const step = values.length <= 1 ? 0 : width / (values.length - 1);
  return values.map((value, index) => ({
    x: index * step,
    y: height - (value / max) * (height - 8) - 4,
  }));
}

function pointsToPath(points: { x: number; y: number }[]) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
}

function pointsToArea(points: { x: number; y: number }[], height: number) {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points.at(-1)!;
  return `${pointsToPath(points)} L ${last.x.toFixed(1)} ${height} L ${first.x.toFixed(1)} ${height} Z`;
}

function niceMaximum(value: number) {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

function successRateLabel(succeeded: number, failed: number, rate: number) {
  return succeeded + failed === 0 ? "—" : `${rate}%`;
}

function deltaLabel(today: number, yesterday: number) {
  if (yesterday === 0) {
    return today === 0 ? "与昨日持平" : "昨日无生成";
  }
  const delta = Math.round(((today - yesterday) / yesterday) * 100);
  if (delta === 0) return "与昨日持平";
  return `较昨日 ${delta > 0 ? "+" : ""}${delta}%`;
}

function toneClass(tone: Tone) {
  if (tone === "success") return "text-success";
  if (tone === "warning") return "text-warning";
  if (tone === "danger") return "text-danger";
  return "text-foreground";
}

function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border border-border bg-surface",
        className,
      )}
    >
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-foreground"
    >
      {children}
      <ArrowUpRight size={12} />
    </Link>
  );
}

function MetricCard({
  label,
  value,
  detail,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  detail: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  return (
    <article className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">{label}</p>
        <Icon size={15} strokeWidth={1.5} className="text-text-faint" />
      </div>
      <p
        className={cn(
          "mt-3 font-mono text-[28px] font-semibold leading-none tracking-tight",
          toneClass(tone),
        )}
      >
        {value}
      </p>
      <p className="mt-2.5 text-[11px] text-text-muted">{detail}</p>
      {hint ? <p className="mt-1 text-[11px] text-text-faint">{hint}</p> : null}
    </article>
  );
}

type Issue = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: Exclude<Tone, "default" | "success">;
};

function buildIssues(stats: AdminStats): Issue[] {
  const issues: Issue[] = [];
  if (!stats.workerOnline) {
    issues.push({
      id: "worker",
      title: "Worker 离线",
      detail: "新任务可能无法被处理，请检查 Worker 与队列服务。",
      href: "/admin/system",
      tone: "danger",
    });
  }
  if (stats.stuckGenerations > 0) {
    issues.push({
      id: "stuck",
      title: `${stats.stuckGenerations} 个任务疑似卡住`,
      detail: "排队超过 2 分钟或运行超过 10 分钟。",
      href: "/admin/generations",
      tone: "danger",
    });
  }
  if (stats.queueFailed > 0) {
    issues.push({
      id: "queue-failed",
      title: `队列中有 ${stats.queueFailed} 条失败记录`,
      detail: "建议结合失败类型和生成记录排查。",
      href: "/admin/generations",
      tone: "warning",
    });
  }
  const completed = stats.succeededToday + stats.failedToday;
  if (completed >= 10 && stats.successRate < 90) {
    issues.push({
      id: "success-rate",
      title: `今日成功率降至 ${stats.successRate}%`,
      detail: "当前样本量已具备参考价值，建议检查异常渠道。",
      href: "/admin/providers",
      tone: stats.successRate < 70 ? "danger" : "warning",
    });
  }
  if (stats.accountSlots > 0) {
    const utilization = (stats.accountInFlight / stats.accountSlots) * 100;
    if (utilization >= 90) {
      issues.push({
        id: "capacity",
        title: `账号并发已占用 ${Math.round(utilization)}%`,
        detail: "容量接近上限，排队延迟可能继续上升。",
        href: "/admin/providers",
        tone: "warning",
      });
    }
  }
  return issues;
}

function HealthPanel({
  stats,
  issues,
}: {
  stats: AdminStats;
  issues: Issue[];
}) {
  const utilization =
    stats.accountSlots === 0
      ? 0
      : Math.min(100, (stats.accountInFlight / stats.accountSlots) * 100);
  const hasDanger = issues.some((issue) => issue.tone === "danger");

  return (
    <Panel
      title="系统健康"
      description="当前队列、Worker 与渠道容量"
      action={
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px] font-medium",
            hasDanger
              ? "text-danger"
              : issues.length > 0
                ? "text-warning"
                : "text-success",
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {hasDanger
            ? "需要立即处理"
            : issues.length > 0
              ? `${issues.length} 项待关注`
              : "运行正常"}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-px bg-border">
        <div className="bg-surface p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Server size={12} /> Worker
          </div>
          <p
            className={cn(
              "mt-2 text-sm font-semibold",
              stats.workerOnline ? "text-success" : "text-danger",
            )}
          >
            {stats.workerOnline ? "在线" : "离线"}
          </p>
          <p className="mt-1 truncate text-[10px] text-text-faint">
            {stats.workerHeartbeatAt
              ? `心跳 ${formatDate(stats.workerHeartbeatAt)}`
              : "暂无心跳"}
          </p>
        </div>
        <div className="bg-surface p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Clock3 size={12} /> 队列
          </div>
          <p className="mt-2 font-mono text-sm font-semibold">
            {stats.queueWaiting} / {stats.queueActive}
          </p>
          <p className="mt-1 text-[10px] text-text-faint">
            等待 / 运行 · {stats.queueDelayed} 延迟
          </p>
        </div>
        <div className="bg-surface p-4">
          <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
            <span>账号并发</span>
            <span className="font-mono">{Math.round(utilization)}%</span>
          </div>
          <p className="mt-2 font-mono text-sm font-semibold">
            {stats.accountInFlight} / {stats.accountSlots}
          </p>
          <svg
            viewBox="0 0 100 4"
            preserveAspectRatio="none"
            className={cn(
              "mt-2 h-1 w-full",
              utilization >= 90 ? "text-warning" : "text-accent",
            )}
            role="img"
            aria-label={`账号并发占用 ${Math.round(utilization)}%`}
          >
            <rect
              width="100"
              height="4"
              rx="2"
              fill="currentColor"
              className="text-border"
            />
            <rect width={utilization} height="4" rx="2" fill="currentColor" />
          </svg>
        </div>
        <div className="bg-surface p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Zap size={12} /> 可用渠道
          </div>
          <p className="mt-2 font-mono text-sm font-semibold">
            {stats.healthyProviders}
          </p>
          <p
            className={cn(
              "mt-1 text-[10px]",
              stats.stuckGenerations > 0 ? "text-danger" : "text-text-faint",
            )}
          >
            {stats.stuckGenerations} 个卡住任务
          </p>
        </div>
      </div>

      <div className="border-t border-border p-3">
        <p className="mb-2 px-1 text-[11px] font-medium text-text-muted">
          处置建议
        </p>
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-success/5 px-3 py-2.5 text-[11px] text-success">
            <CheckCircle2 size={14} />
            当前没有需要处理的异常
          </div>
        ) : (
          <div className="space-y-1.5">
            {issues.slice(0, 4).map((issue) => (
              <Link
                key={issue.id}
                href={issue.href}
                className="group flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-surface-2"
              >
                <AlertTriangle
                  size={14}
                  className={cn("mt-0.5 shrink-0", toneClass(issue.tone))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium">
                    {issue.title}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-text-muted">
                    {issue.detail}
                  </span>
                </span>
                <ArrowRight
                  size={12}
                  className="mt-1 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function ActivityPanel({
  daily,
  hourly,
}: {
  daily: AdminStats["dailySeries"];
  hourly: AdminStats["hourlySeries"];
}) {
  const [range, setRange] = useState<"daily" | "hourly">("daily");
  const source: (DailyPoint | HourlyPoint)[] =
    range === "daily" ? daily : hourly;
  const points = source.map((item) => {
    const isDaily = "date" in item;
    const date = new Date(isDaily ? `${item.date}T00:00:00` : item.hour);
    return {
      key: isDaily ? item.date : item.hour,
      label: isDaily
        ? item.date.slice(5).replace("-", "/")
        : `${date.getHours()}:00`,
      title: isDaily
        ? item.date
        : date.toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
      total: item.total,
      succeeded: item.succeeded,
      failed: item.failed,
      credits: isDaily ? item.credits : null,
    };
  });
  const summary = points.reduce(
    (total, point) => ({
      total: total.total + point.total,
      succeeded: total.succeeded + point.succeeded,
      failed: total.failed + point.failed,
      credits: total.credits + (point.credits ?? 0),
    }),
    { total: 0, succeeded: 0, failed: 0, credits: 0 },
  );
  const completed = summary.succeeded + summary.failed;
  const rate = completed === 0 ? 0 : (summary.succeeded / completed) * 100;
  const maximum = niceMaximum(
    Math.max(
      0,
      ...points.flatMap((point) => [
        point.total,
        point.succeeded,
        point.failed,
      ]),
    ),
  );
  const width = 680;
  const height = 190;
  const totals = chartPoints(
    points.map((point) => point.total),
    width,
    height,
    maximum,
  );
  const succeeded = chartPoints(
    points.map((point) => point.succeeded),
    width,
    height,
    maximum,
  );
  const failed = chartPoints(
    points.map((point) => point.failed),
    width,
    height,
    maximum,
  );
  const labelEvery = range === "daily" ? 2 : 3;

  return (
    <Panel
      title="生成活动"
      description="任务量与终态结果，按统一数量尺度展示"
      action={
        <div className="flex rounded-md border border-border p-0.5">
          {(
            [
              ["daily", "近 14 天"],
              ["hourly", "近 24 小时"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] transition-colors",
                range === value
                  ? "bg-surface-2 font-medium text-foreground"
                  : "text-text-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="px-4 pb-4 pt-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono text-xl font-semibold">
            {formatNumber(summary.total)}
            <span className="ml-1 font-sans text-[11px] font-normal text-text-muted">
              次生成
            </span>
          </span>
          <span className="text-[11px] text-text-muted">
            成功率 {completed === 0 ? "—" : `${rate.toFixed(1)}%`}
          </span>
          <span className="text-[11px] text-danger">失败 {summary.failed}</span>
          {range === "daily" ? (
            <span className="text-[11px] text-text-muted">
              消耗 {formatNumber(summary.credits)} 点
            </span>
          ) : null}
        </div>
        <div className="relative">
          <svg
            viewBox="0 0 736 238"
            className="h-64 w-full"
            role="img"
            aria-label={`${range === "daily" ? "近 14 天" : "近 24 小时"}生成趋势`}
          >
            <g transform="translate(42 8)">
              {[0, 0.5, 1].map((fraction) => {
                const y = height * fraction;
                const value = Math.round(maximum * (1 - fraction));
                return (
                  <g key={fraction}>
                    <line
                      x1="0"
                      y1={y}
                      x2={width}
                      y2={y}
                      stroke="currentColor"
                      strokeWidth="1"
                      strokeDasharray="3 5"
                      className="text-border"
                    />
                    <text
                      x="-8"
                      y={y + 3}
                      textAnchor="end"
                      fill="currentColor"
                      className="font-mono text-[9px] text-text-faint"
                    >
                      {value}
                    </text>
                  </g>
                );
              })}
              <path
                d={pointsToArea(totals, height)}
                fill="currentColor"
                fillOpacity="0.055"
                className="text-accent"
              />
              <path
                d={pointsToPath(totals)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-accent"
              />
              <path
                d={pointsToPath(succeeded)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
              />
              <path
                d={pointsToPath(failed)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-danger"
              />
              {totals.map((point, index) => {
                const item = points[index];
                return (
                  <g key={item.key}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="2.5"
                      fill="currentColor"
                      className="text-accent"
                    >
                      <title>
                        {`${item.title} · 总量 ${item.total} · 成功 ${item.succeeded} · 失败 ${item.failed}`}
                      </title>
                    </circle>
                    {index % labelEvery === 0 || index === points.length - 1 ? (
                      <text
                        x={point.x}
                        y={height + 20}
                        textAnchor={
                          index === 0
                            ? "start"
                            : index === points.length - 1
                              ? "end"
                              : "middle"
                        }
                        fill="currentColor"
                        className="font-mono text-[9px] text-text-faint"
                      >
                        {item.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
          {summary.total === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6 text-xs text-text-faint">
              当前时段暂无生成
            </div>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-4 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <span className="h-0.5 w-3 bg-accent" /> 总量
          </span>
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <span className="h-0.5 w-3 bg-success" /> 成功
          </span>
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <span className="h-0.5 w-3 bg-danger" /> 失败
          </span>
        </div>
      </div>
    </Panel>
  );
}

function ProviderStatsPanel({
  providers,
}: {
  providers: AdminStats["providerStats"];
}) {
  const sorted = [...providers].sort(
    (a, b) =>
      b.failed - a.failed || a.successRate - b.successRate || b.total - a.total,
  );
  return (
    <Panel
      title="渠道表现"
      description="近 30 天，按失败数优先；最多分析最近 2000 条任务"
      action={<PanelLink href="/admin/providers">管理渠道</PanelLink>}
    >
      {sorted.length === 0 ? (
        <p className="px-4 py-8 text-xs text-text-muted">暂无渠道数据</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-border text-[10px] text-text-faint">
                <th className="px-4 py-2.5 font-medium">渠道</th>
                <th className="px-3 py-2.5 font-medium">任务</th>
                <th className="px-3 py-2.5 font-medium">成功率</th>
                <th className="px-3 py-2.5 font-medium">平均耗时</th>
                <th className="px-4 py-2.5 text-right font-medium">消耗</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {sorted.map((provider) => {
                const hasOutcome = provider.succeeded + provider.failed > 0;
                const tone: Tone = !hasOutcome
                  ? "default"
                  : provider.successRate >= 90
                    ? "success"
                    : provider.successRate >= 70
                      ? "warning"
                      : "danger";
                return (
                  <tr
                    key={
                      provider.providerChannelId ??
                      provider.providerId ??
                      provider.providerName
                    }
                  >
                    <td className="max-w-48 truncate px-4 py-3 text-xs font-medium">
                      {provider.providerName}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {provider.total}
                      <span className="ml-1.5 text-[10px] text-text-faint">
                        / 失败 {provider.failed}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 font-mono text-xs font-semibold",
                        toneClass(tone),
                      )}
                    >
                      {successRateLabel(
                        provider.succeeded,
                        provider.failed,
                        provider.successRate,
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-text-muted">
                      {formatDuration(provider.avgRunMs)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-text-muted">
                      {formatNumber(provider.credits)} 点
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function BreakdownPanel({
  title,
  description,
  rows,
  emptyText,
  color,
  action,
}: {
  title: string;
  description: string;
  rows: { label: string; value: number; hint?: string }[];
  emptyText: string;
  color: "danger" | "accent";
  action?: ReactNode;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  return (
    <Panel title={title} description={description} action={action}>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-xs text-text-muted">{emptyText}</p>
      ) : (
        <div className="space-y-3.5 p-4">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span
                  className="truncate font-mono text-[11px] text-text-muted"
                  title={row.label}
                >
                  {row.label}
                </span>
                <span className="shrink-0 font-mono text-[11px]">
                  {formatNumber(row.value)}
                  {row.hint ? (
                    <span className="ml-1.5 text-text-faint">{row.hint}</span>
                  ) : null}
                </span>
              </div>
              <svg
                viewBox="0 0 100 6"
                preserveAspectRatio="none"
                className={cn(
                  "h-1.5 w-full",
                  color === "danger" ? "text-danger" : "text-accent",
                )}
                role="img"
                aria-label={`${row.label}：${row.value}`}
              >
                <rect
                  width="100"
                  height="6"
                  rx="3"
                  fill="currentColor"
                  className="text-border"
                />
                <rect
                  width={(row.value / maximum) * 100}
                  height="6"
                  rx="3"
                  fill="currentColor"
                />
              </svg>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TopUsersPanel({ users }: { users: AdminStats["topUsers"] }) {
  return (
    <Panel
      title="高活跃用户"
      description="近 30 天按生成次数排序"
      action={<PanelLink href="/admin/users">全部用户</PanelLink>}
    >
      {users.length === 0 ? (
        <p className="px-4 py-8 text-xs text-text-muted">暂无用户数据</p>
      ) : (
        <div className="divide-y divide-border/60">
          {users.map((user, index) => (
            <Link
              key={user.userId}
              href={`/admin/users/${user.userId}`}
              className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
            >
              <span className="w-5 font-mono text-[11px] text-text-faint">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {user.name || user.email}
                </span>
                {user.name ? (
                  <span className="mt-0.5 block truncate text-[10px] text-text-faint">
                    {user.email}
                  </span>
                ) : null}
              </span>
              <span className="text-right">
                <span className="block font-mono text-xs">
                  {formatNumber(user.generations)} 次
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-text-faint">
                  {formatNumber(user.credits)} 点
                </span>
              </span>
              <ArrowUpRight
                size={12}
                className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
              />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-label="正在加载运营数据" className="animate-pulse">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-[142px] rounded-xl border border-border bg-surface"
          />
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <div className="h-[420px] rounded-xl border border-border bg-surface" />
        <div className="h-[420px] rounded-xl border border-border bg-surface" />
      </div>
    </div>
  );
}

export function DashboardView() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const mountedRef = useRef(false);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (mountedRef.current) {
      setRefreshing(true);
      setError(null);
    }
    try {
      const data = await getAdminStats();
      if (!mountedRef.current) return;
      setStats(data);
      setUpdatedAt(new Date());
    } catch {
      if (mountedRef.current) {
        setError("统计数据刷新失败，请检查服务后重试");
      }
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [load]);

  const daily = useMemo(
    () => (stats ? normalizeDailySeries(stats.dailySeries) : []),
    [stats],
  );
  const hourly = useMemo(
    () => (stats ? normalizeHourlySeries(stats.hourlySeries) : []),
    [stats],
  );

  const header = (
    <AdminPageHeader
      eyebrow="Operations"
      title="运营概览"
      description="生成服务健康、负载与消费趋势"
      actions={
        <>
          <div className="hidden text-right sm:block">
            <p className="text-[11px] text-text-muted" aria-live="polite">
              {updatedAt
                ? `更新于 ${updatedAt.toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })}`
                : "等待首次更新"}
            </p>
            <p className="mt-0.5 text-[10px] text-text-faint">
              可见时每 30 秒自动刷新
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="border border-border"
            disabled={refreshing}
            onClick={() => void load()}
          >
            <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
            {refreshing ? "刷新中" : "刷新"}
          </Button>
        </>
      }
    />
  );

  if (!stats) {
    return (
      <div>
        {header}
        {error ? (
          <div className="rounded-xl border border-border bg-surface p-6">
            <EmptyPanel text={error} />
            <Button
              type="button"
              size="sm"
              className="mt-4"
              onClick={() => void load()}
            >
              重新加载
            </Button>
          </div>
        ) : (
          <DashboardSkeleton />
        )}
      </div>
    );
  }

  const issues = buildIssues(stats);
  const completed = stats.succeededToday + stats.failedToday;
  const successTone: Tone =
    completed === 0
      ? "default"
      : stats.successRate >= 90
        ? "success"
        : stats.successRate >= 70
          ? "warning"
          : "danger";

  return (
    <div>
      {header}
      {error ? (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
        >
          <span>{error}，当前展示的是上次成功数据。</span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2"
            onClick={() => void load()}
          >
            重试
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="今日生成"
          value={formatNumber(stats.todayGenerations)}
          detail={deltaLabel(stats.todayGenerations, daily.at(-2)?.total ?? 0)}
          hint={`成功 ${stats.succeededToday} · 失败 ${stats.failedToday}`}
          icon={ImageIcon}
        />
        <MetricCard
          label="今日成功率"
          value={successRateLabel(
            stats.succeededToday,
            stats.failedToday,
            stats.successRate,
          )}
          detail={
            completed === 0
              ? "今日暂无已完成任务"
              : `${completed} 个任务已完成终态`
          }
          hint="成功率按成功 /（成功 + 失败）计算"
          icon={Activity}
          tone={successTone}
        />
        <MetricCard
          label="今日消耗点数"
          value={formatNumber(stats.creditsToday)}
          detail="按今日点数扣减流水统计"
          hint={`用户余额合计 ${formatNumber(stats.userCredits)} 点`}
          icon={Coins}
        />
        <MetricCard
          label="有效账户"
          value={formatNumber(stats.onlineUsers)}
          detail="状态为 ACTIVE 的用户账户"
          icon={Users}
        />
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <ActivityPanel daily={daily} hourly={hourly} />
        <HealthPanel stats={stats} issues={issues} />
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
        <ProviderStatsPanel providers={stats.providerStats} />
        <BreakdownPanel
          title="失败诊断"
          description="近 30 天失败错误码分布"
          emptyText="近 30 天暂无失败"
          color="danger"
          action={<PanelLink href="/admin/generations">生成记录</PanelLink>}
          rows={stats.errorBreakdown.map((item) => ({
            label: item.code,
            value: item.count,
          }))}
        />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <BreakdownPanel
          title="模型使用"
          description="近 30 天生成次数与点数消耗"
          emptyText="近 30 天暂无生成"
          color="accent"
          action={<PanelLink href="/admin/pricing">模型定价</PanelLink>}
          rows={stats.modelUsage.map((item) => ({
            label: item.modelId,
            value: item.generations,
            hint: `${formatNumber(item.credits)} 点`,
          }))}
        />
        <TopUsersPanel users={stats.topUsers} />
      </div>

      <p className="mt-4 text-[10px] leading-5 text-text-faint">
        今日指标按自然日统计；渠道、失败、模型和用户榜按近 30
        天统计。队列失败数为队列服务返回的累计值。
      </p>
    </div>
  );
}
