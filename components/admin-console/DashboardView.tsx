"use client";

import { useEffect, useRef, useState } from "react";

import { formatDate } from "@/lib/utils";

import { getAdminStats } from "./lib/api";
import type { AdminStats } from "./lib/types";
import { AdminPageHeader, EmptyPanel } from "./ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

function chartPoints(
  values: number[],
  width: number,
  height: number,
): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const max = Math.max(1, ...values);
  const step = values.length <= 1 ? 0 : width / (values.length - 1);
  return values.map((v, i) => ({
    x: i * step,
    y: height - (v / max) * (height - 8) - 4,
  }));
}

function pointsToPath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

function pointsToArea(pts: { x: number; y: number }[], height: number): string {
  if (pts.length === 0) return "";
  const line = pointsToPath(pts);
  const last = pts[pts.length - 1];
  const first = pts[0];
  return `${line} L ${last.x.toFixed(1)} ${height} L ${first.x.toFixed(1)} ${height} Z`;
}

// ─── Bento metric card ────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  tone,
  large,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "success" | "warning" | "danger";
  large?: boolean;
  accent?: boolean;
}) {
  const accentColor =
    tone === "success"
      ? "border-l-success"
      : tone === "danger"
        ? "border-l-danger"
        : tone === "warning"
          ? "border-l-warning"
          : accent
            ? "border-l-accent"
            : "border-l-transparent";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface p-4 border-l-[3px]",
        accentColor,
      )}
    >
      <p className="text-xs text-text-muted">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-mono font-semibold tracking-tight",
          large ? "text-3xl" : "text-2xl",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-text-faint">{sub}</p>}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function DashboardView() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getAdminStats()
        .then((data) => { if (!cancelled) setStats(data); })
        .catch(() => { if (!cancelled) setFailed(true); });
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  if (failed) return <EmptyPanel text="统计数据暂时不可用，请稍后刷新" />;

  if (!stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
    );
  }

  const successTone =
    stats.successRate >= 90
      ? "success"
      : stats.successRate >= 70
        ? "warning"
        : "danger";

  return (
    <div>
      <AdminPageHeader eyebrow="Overview" title="仪表盘" description="每 30 秒自动刷新" />

      {/* Bento grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Large: today generations */}
        <div className="sm:col-span-2">
          <MetricCard
            label="今日生成"
            value={stats.todayGenerations}
            sub={`成功 ${stats.succeededToday} · 失败 ${stats.failedToday}`}
            accent
            large
          />
        </div>
        {/* Large: success rate */}
        <div className="sm:col-span-2">
          <MetricCard
            label="今日成功率"
            value={`${stats.successRate}%`}
            tone={successTone}
            large
          />
        </div>

        <MetricCard
          label="今日消耗点数"
          value={stats.creditsToday}
          sub={`余额总计 ${stats.userCredits}`}
        />
        <MetricCard
          label="在线用户"
          value={stats.onlineUsers}
          sub={`健康渠道 ${stats.healthyProviders}`}
        />
        <MetricCard
          label="队列"
          value={`${stats.queueWaiting} / ${stats.queueActive}`}
          sub={`等待 / 运行 · 失败 ${stats.queueFailed}`}
          tone={stats.queueFailed > 0 ? "danger" : undefined}
        />
        <MetricCard
          label="账号并发"
          value={`${stats.accountInFlight} / ${stats.accountSlots}`}
          sub="在飞 / 总槽位"
          accent={stats.accountInFlight > 0}
        />
        <MetricCard
          label="Worker"
          value={stats.workerOnline ? "在线" : "离线"}
          tone={stats.workerOnline ? "success" : "danger"}
          sub={stats.workerHeartbeatAt ? `心跳 ${formatDate(stats.workerHeartbeatAt)}` : "暂无心跳"}
        />
        <MetricCard
          label="卡住任务"
          value={stats.stuckGenerations}
          tone={stats.stuckGenerations > 0 ? "danger" : undefined}
          sub="PENDING>2min 或 RUNNING>10min"
        />
      </div>

      {/* Charts row */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <TrendPanel data={stats.dailySeries} />
        <HourlyPanel data={stats.hourlySeries} />
      </div>

      {/* Tables row */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TopUsersPanel users={stats.topUsers} />
        <ProviderStatsPanel providers={stats.providerStats} />
      </div>

      {/* Breakdown row */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <BarPanel
          title="失败类型"
          emptyText="近 30 天暂无失败"
          color="danger"
          rows={stats.errorBreakdown.map((e) => ({ label: e.code, value: e.count }))}
        />
        <BarPanel
          title="模型使用"
          emptyText="近 30 天暂无生成"
          color="accent"
          rows={stats.modelUsage.map((m) => ({ label: m.modelId, value: m.generations, hint: `${m.credits} 点` }))}
        />
      </div>
    </div>
  );
}

// ─── Trend chart ──────────────────────────────────────────────────────────────

function TrendPanel({ data }: { data: AdminStats["dailySeries"] }) {
  const W = 640, H = 160;
  const totals = data.map((d) => d.total);
  const succeeded = data.map((d) => d.succeeded);
  const failed = data.map((d) => d.failed);
  const ptsTotals = chartPoints(totals, W, H);
  const ptsSucceeded = chartPoints(succeeded, W, H);
  const ptsFailed = chartPoints(failed, W, H);
  const gradId = "trend-grad";
  const gradSuccId = "trend-succ-grad";

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">近 14 天生成趋势</h2>
          <p className="text-xs text-text-muted">总量 / 成功 / 失败</p>
        </div>
        <div className="flex gap-3 text-[11px]">
          <span className="text-accent">总量</span>
          <span className="text-success">成功</span>
          <span className="text-danger">失败</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" className="text-accent" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-accent" />
          </linearGradient>
          <linearGradient id={gradSuccId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.08" className="text-success" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-success" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1="0" y1={H * f} x2={W} y2={H * f}
            stroke="currentColor"
            strokeWidth="1"
            className="text-border"
            strokeDasharray="4 4"
          />
        ))}
        {/* Area fills */}
        <path d={pointsToArea(ptsTotals, H)} fill={`url(#${gradId})`} />
        <path d={pointsToArea(ptsSucceeded, H)} fill={`url(#${gradSuccId})`} />
        {/* Lines */}
        <path d={pointsToPath(ptsTotals)} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-accent" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pointsToPath(ptsSucceeded)} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-success" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pointsToPath(ptsFailed)} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-danger" strokeLinecap="round" strokeLinejoin="round" />
        {/* Data dots on total */}
        {ptsTotals.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="currentColor" className="text-accent">
            <title>{data[i]?.date}: {data[i]?.total} 次 · {data[i]?.credits} 点</title>
          </circle>
        ))}
      </svg>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        {data.slice(-4).map((d) => (
          <div key={d.date} className="rounded-lg border border-border px-2.5 py-2">
            <p className="font-mono text-text-muted">{d.date.slice(5)}</p>
            <p className="mt-0.5 font-mono text-text-faint">{d.total} 次</p>
            <p className="text-text-faint">{d.credits} 点</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Hourly chart ─────────────────────────────────────────────────────────────

function HourlyPanel({ data }: { data: AdminStats["hourlySeries"] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const currentHour = new Date().getHours();

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">近 24 小时</h2>
      <p className="mt-0.5 text-xs text-text-muted">按小时统计</p>
      <div className="mt-4 flex h-44 items-end gap-px">
        {data.map((d) => {
          const h = new Date(d.hour).getHours();
          const isCurrent = h === currentHour;
          const pct = Math.max(3, (d.total / max) * 152);
          return (
            <div key={d.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div
                className={cn(
                  "w-full rounded-t transition-all",
                  isCurrent ? "bg-accent" : "bg-accent/30",
                )}
                style={{ height: `${pct}px` }}
                title={`${h}:00 · ${d.total} 次 · 成功 ${d.succeeded}`}
              />
              {h % 6 === 0 && (
                <span className="font-mono text-[9px] text-text-faint">{h}</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Top users ────────────────────────────────────────────────────────────────

const MEDALS = ["🥇", "🥈", "🥉"];

function TopUsersPanel({ users }: { users: AdminStats["topUsers"] }) {
  return (
    <section className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">用户榜 · 近 30 天</h2>
      </div>
      {users.length === 0 ? (
        <p className="px-4 py-6 text-xs text-text-muted">暂无数据</p>
      ) : (
        <div className="divide-y divide-border">
          {users.map((u, i) => (
            <div key={u.userId} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-5 text-center text-base">
                {MEDALS[i] ?? <span className="font-mono text-xs text-text-faint">{i + 1}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{u.name || u.email}</p>
                {u.name && <p className="truncate text-[11px] text-text-faint">{u.email}</p>}
              </div>
              <div className="text-right">
                <p className="font-mono text-xs">{u.generations}</p>
                <p className="font-mono text-[11px] text-text-faint">{u.credits} 点</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Provider stats ───────────────────────────────────────────────────────────

function ProviderStatsPanel({ providers }: { providers: AdminStats["providerStats"] }) {
  return (
    <section className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">渠道表现 · 近 30 天</h2>
      </div>
      {providers.length === 0 ? (
        <p className="px-4 py-6 text-xs text-text-muted">暂无渠道数据</p>
      ) : (
        <div className="divide-y divide-border">
          {providers.map((p) => {
            const srColor =
              p.successRate >= 90
                ? "text-success"
                : p.successRate >= 70
                  ? "text-warning"
                  : "text-danger";
            const dotColor =
              p.successRate >= 90
                ? "bg-success"
                : p.successRate >= 70
                  ? "bg-warning"
                  : "bg-danger";
            return (
              <div
                key={p.providerChannelId ?? p.providerId ?? p.providerName}
                className="px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotColor)} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {p.providerName}
                  </span>
                  <span className={cn("font-mono text-xs font-semibold", srColor)}>
                    {p.successRate}%
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        p.successRate >= 90
                          ? "bg-success"
                          : p.successRate >= 70
                            ? "bg-warning"
                            : "bg-danger",
                      )}
                      style={{ width: `${p.successRate}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-text-faint">
                    {p.total} 次
                    {p.avgRunMs !== null ? ` · ${Math.round(p.avgRunMs / 1000)}s` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Bar panel ────────────────────────────────────────────────────────────────

function BarPanel({
  title,
  rows,
  emptyText,
  color,
}: {
  title: string;
  rows: { label: string; value: number; hint?: string }[];
  emptyText: string;
  color: "danger" | "accent";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const barClass = color === "danger" ? "bg-danger" : "bg-accent";

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">{emptyText}</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono text-[11px] text-text-muted">{row.label}</span>
                <span className="font-mono text-text-faint">
                  {row.value}
                  {row.hint && <span className="ml-1.5">{row.hint}</span>}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className={cn("h-full rounded-full transition-all", barClass)}
                  style={{ width: `${(row.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
