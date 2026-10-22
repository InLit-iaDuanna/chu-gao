"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

import { Button, Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

import {
  createAdminProvider,
  disableAdminProvider,
  isAdminApiError,
  listAdminProviders,
  patchAdminProvider,
  restoreAdminProvider,
  testAdminProvider,
} from "./lib/api";
import type { AdminProvider, AdminProviderInput } from "./lib/types";
import { ProviderAccounts } from "./ProviderAccounts";
import { AdminField, AdminPageHeader, EmptyPanel, ErrorText } from "./ui";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROTOCOL_OPTIONS = [
  { value: "OPENAI_IMAGES", label: "OpenAI Images" },
  { value: "OPENAI_RESPONSES_IMAGE", label: "OpenAI Responses Image" },
  { value: "GEMINI_IMAGE", label: "Gemini Image" },
] as const;

// ─── Health indicator ─────────────────────────────────────────────────────────

function HealthDot({ health, size = "md" }: { health: string; size?: "sm" | "md" }) {
  const color =
    health === "HEALTHY"
      ? "bg-success"
      : health === "DEGRADED"
        ? "bg-warning"
        : "bg-danger";
  const dim = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full",
        dim,
        color,
        health === "HEALTHY" && "shadow-[0_0_0_3px] shadow-success/20",
      )}
    />
  );
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function HealthBar({ healthy, degraded, down }: { healthy: number; degraded: number; down: number }) {
  const total = healthy + degraded + down;
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 w-20 overflow-hidden rounded-full bg-border" title={`健康 ${healthy} / 降级 ${degraded} / DOWN ${down}`}>
      {healthy > 0 && <div className="bg-success" style={{ width: `${(healthy / total) * 100}%` }} />}
      {degraded > 0 && <div className="bg-warning" style={{ width: `${(degraded / total) * 100}%` }} />}
      {down > 0 && <div className="bg-danger" style={{ width: `${(down / total) * 100}%` }} />}
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]",
      accent ? "border-accent/30 bg-accent/[0.06] text-accent" : "border-border bg-surface text-text-muted",
    )}>
      <span className="text-text-faint">{label}</span>
      {value}
    </span>
  );
}

// ─── Error log panel ──────────────────────────────────────────────────────────

function ErrorLogPanel({
  providers,
  onExpand,
}: {
  providers: AdminProvider[];
  onExpand: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const errored = providers.filter((p) => p.lastErrorMsg && p.isActive);
  if (errored.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-danger/20 bg-danger/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-danger"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          {errored.length} 个渠道有错误
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-danger/60" /> : <ChevronRight className="h-3.5 w-3.5 text-danger/60" />}
      </button>
      {open && (
        <div className="divide-y divide-danger/10 border-t border-danger/10">
          {errored.map((p) => (
            <div key={p.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{p.name}</span>
                  {p.lastErrorAt && (
                    <span className="text-[10px] text-text-faint">
                      {new Date(p.lastErrorAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-danger/80">{p.lastErrorMsg}</p>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); onExpand(p.id); }}
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted hover:text-foreground"
              >
                查看
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ProvidersView() {
  const [providers, setProviders] = useState<AdminProvider[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    setFailed(false);
    listAdminProviders().then(setProviders).catch(() => setFailed(true));
  }, []);

  useEffect(reload, [reload]);

  async function run(action: () => Promise<unknown>, okMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okMessage);
      reload();
    } catch (actionError) {
      setError(isAdminApiError(actionError) ? actionError.message : "操作失败");
    }
  }

  const handleRestoreAll = async () => {
    if (!providers) return;
    const down = providers.filter((p) => p.isActive && p.health === "DOWN");
    if (down.length === 0) return;
    setBulkBusy("restore");
    setError(null);
    try {
      await Promise.all(down.map((p) => restoreAdminProvider(p.id)));
      setNotice(`已恢复 ${down.length} 个渠道`);
      reload();
    } catch {
      setError("部分恢复失败，请单独处理");
    } finally {
      setBulkBusy(null);
    }
  };

  const handleTestAll = async () => {
    if (!providers) return;
    const active = providers.filter((p) => p.isActive);
    if (active.length === 0) return;
    setBulkBusy("test");
    setError(null);
    let passed = 0;
    let failed_count = 0;
    for (const p of active) {
      try { await testAdminProvider(p.id); passed++; }
      catch { failed_count++; }
    }
    setNotice(`全部测试完成：${passed} 通过 / ${failed_count} 失败`);
    reload();
    setBulkBusy(null);
  };

  const healthy = providers?.filter((p) => p.isActive && p.health === "HEALTHY").length ?? 0;
  const total = providers?.filter((p) => p.isActive).length ?? 0;
  const inFlight = providers?.reduce((s, p) => s + p.inFlight, 0) ?? 0;
  const hasDown = providers?.some((p) => p.isActive && p.health === "DOWN") ?? false;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Providers"
        title="渠道管理"
        description="出图账号池、健康状态与并发控制"
        actions={
          <div className="flex items-center gap-2">
            {hasDown && (
              <button
                type="button"
                disabled={bulkBusy !== null}
                onClick={handleRestoreAll}
                className="flex h-8 items-center gap-1.5 rounded-md border border-success/30 px-3 text-sm text-success hover:bg-success/[0.06] disabled:opacity-40"
              >
                {bulkBusy === "restore" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                恢复 DOWN 渠道
              </button>
            )}
            <button
              type="button"
              disabled={bulkBusy !== null}
              onClick={handleTestAll}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-text-muted hover:text-foreground disabled:opacity-40"
            >
              {bulkBusy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              全部测试
            </button>
            <button
              type="button"
              onClick={reload}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:text-foreground"
              title="刷新"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <Button type="button" className="h-8 px-3 text-sm" onClick={() => setCreating((v) => !v)}>
              <Plus className="h-3.5 w-3.5" />
              新建渠道
            </Button>
          </div>
        }
      />

      {/* Summary strip */}
      {providers && providers.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <StatChip label="渠道健康" value={`${healthy}/${total}`} accent={healthy === total && total > 0} />
          <StatChip label="并发中" value={inFlight} accent={inFlight > 0} />
          <StatChip label="总账号" value={providers.reduce((s, p) => s + p.accountCount, 0)} />
          <StatChip label="活跃账号" value={providers.reduce((s, p) => s + p.activeAccountCount, 0)} />
        </div>
      )}

      {/* Error log */}
      {providers && (
        <ErrorLogPanel
          providers={providers}
          onExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
        />
      )}

      <ErrorText message={error} />
      {notice && <p className="mb-4 text-sm text-success">{notice}</p>}

      {creating && (
        <CreateProviderForm
          onCreate={(input) =>
            run(() => createAdminProvider(input), "渠道已创建").then(() => setCreating(false))
          }
          onCancel={() => setCreating(false)}
        />
      )}

      {failed ? (
        <EmptyPanel text="渠道列表暂时不可用" />
      ) : !providers ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-surface" />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <EmptyPanel text="还没有渠道，点击「新建渠道」开始" />
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              expanded={expandedId === provider.id}
              onToggle={() => setExpandedId((cur) => (cur === provider.id ? null : provider.id))}
              onRun={run}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Edit provider form ───────────────────────────────────────────────────────

function EditProviderForm({
  provider,
  onSave,
  onCancel,
}: {
  provider: AdminProvider;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: provider.name,
    baseUrl: provider.baseUrl,
    priority: provider.priority,
    costMultiplier: provider.costMultiplier,
    modelsSupported: provider.modelsSupported.join(", "),
    note: provider.note ?? "",
    apiKey: "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3 border-t border-border/50 bg-foreground/[0.015] px-4 py-4">
      <p className="text-xs font-medium text-text-muted">编辑渠道</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="名称">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </AdminField>
        <AdminField label="Base URL">
          <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
        </AdminField>
        <AdminField label="优先级">
          <Input type="number" min={0} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
        </AdminField>
        <AdminField label="成本倍率">
          <Input type="number" min={0} step={0.1} value={form.costMultiplier} onChange={(e) => setForm({ ...form, costMultiplier: Number(e.target.value) })} />
        </AdminField>
        <AdminField label="支持模型（逗号分隔）" className="sm:col-span-2">
          <Input value={form.modelsSupported} onChange={(e) => setForm({ ...form, modelsSupported: e.target.value })} />
        </AdminField>
        <AdminField label="更换 API Key（留空不变）" className="sm:col-span-2">
          <Input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </AdminField>
        <AdminField label="备注" className="sm:col-span-2">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </AdminField>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy}
          className="h-8 px-3 text-xs disabled:opacity-45"
          onClick={() => {
            setBusy(true);
            const patch: Record<string, unknown> = {
              name: form.name.trim(),
              baseUrl: form.baseUrl.trim(),
              priority: form.priority,
              costMultiplier: form.costMultiplier,
              modelsSupported: form.modelsSupported.split(",").map((s) => s.trim()).filter(Boolean),
              note: form.note.trim() || undefined,
            };
            if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim();
            void onSave(patch).finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          保存
        </Button>
        <Button type="button" className="h-8 px-3 text-xs text-text-muted" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

// ─── Create provider form ─────────────────────────────────────────────────────

function CreateProviderForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: AdminProviderInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    protocol: "OPENAI_IMAGES" as AdminProviderInput["protocol"],
    baseUrl: "",
    apiKey: "",
    priority: 0,
    costMultiplier: 1,
    modelsSupported: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);

  const valid = form.name.trim() && form.baseUrl.trim() && form.apiKey.trim() && form.modelsSupported.trim();

  return (
    <div className="mb-4 rounded-xl border border-accent/20 bg-accent/[0.03] p-5">
      <p className="mb-4 text-sm font-semibold">新建渠道</p>

      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-faint">基本信息</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <AdminField label="名称">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </AdminField>
        <AdminField label="协议">
          <Select aria-label="协议" value={form.protocol} onValueChange={(v) => setForm({ ...form, protocol: v as AdminProviderInput["protocol"] })} options={[...PROTOCOL_OPTIONS]} />
        </AdminField>
        <AdminField label="支持模型（逗号分隔）" className="sm:col-span-2">
          <Input placeholder="gpt-image-1.5, doubao-seedream-4-5" value={form.modelsSupported} onChange={(e) => setForm({ ...form, modelsSupported: e.target.value })} />
        </AdminField>
      </div>

      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-faint">连接</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <AdminField label="Base URL">
          <Input placeholder="https://…" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
        </AdminField>
        <AdminField label="API Key">
          <Input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </AdminField>
      </div>

      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-faint">调度</p>
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <AdminField label="优先级（越大越优先）">
          <Input type="number" min={0} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
        </AdminField>
        <AdminField label="成本倍率">
          <Input type="number" min={0} step={0.1} value={form.costMultiplier} onChange={(e) => setForm({ ...form, costMultiplier: Number(e.target.value) })} />
        </AdminField>
        <AdminField label="备注（可选）" className="sm:col-span-2">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </AdminField>
      </div>

      <div className="flex gap-2">
        <Button type="button" disabled={busy || !valid} className="h-9 px-4 text-sm disabled:opacity-45"
          onClick={() => {
            setBusy(true);
            void onCreate({
              name: form.name.trim(), protocol: form.protocol, baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim(),
              priority: form.priority, costMultiplier: form.costMultiplier,
              modelsSupported: form.modelsSupported.split(",").map((s) => s.trim()).filter(Boolean),
              note: form.note.trim() || undefined,
            }).finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          创建渠道
        </Button>
        <Button type="button" className="h-9 px-4 text-sm text-text-muted" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

// ─── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  expanded,
  onToggle,
  onRun,
}: {
  provider: AdminProvider;
  expanded: boolean;
  onToggle: () => void;
  onRun: (action: () => Promise<unknown>, okMessage: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const act = (key: string, action: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    void onRun(action, ok).finally(() => setBusy(null));
  };

  const isDown = provider.health === "DOWN";
  const isDegraded = provider.health === "DEGRADED";
  const healthyAccounts = provider.healthyAccountCount;
  const downAccounts = provider.activeAccountCount - healthyAccounts;

  return (
    <div className={cn(
      "overflow-hidden rounded-xl border transition-colors",
      !provider.isActive ? "border-border/50 opacity-60" :
      isDown ? "border-danger/30 bg-danger/[0.02]" :
      isDegraded ? "border-warning/30 bg-warning/[0.02]" :
      "border-border bg-surface",
    )}>
      {/* Colored top status bar */}
      <div className={cn("h-0.5", !provider.isActive ? "bg-border" : isDown ? "bg-danger" : isDegraded ? "bg-warning" : "bg-success")} />

      {/* Header row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-expanded={expanded}>
          <HealthDot health={provider.isActive ? provider.health : "DOWN"} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{provider.name}</span>
              {!provider.isActive && <span className="shrink-0 rounded border border-danger/30 px-1 py-px text-[10px] text-danger">已停用</span>}
            </span>
            <span className="block truncate font-mono text-[11px] text-text-faint">{provider.protocol} · {provider.baseUrl}</span>
          </span>
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-faint" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint" />}
        </button>

        {/* Stats with mini health bar */}
        <div className="flex flex-wrap items-center gap-2">
          <HealthBar healthy={healthyAccounts} degraded={0} down={downAccounts} />
          <StatChip label="账号" value={`${provider.healthyAccountCount}/${provider.activeAccountCount}`} accent={provider.healthyAccountCount === provider.activeAccountCount && provider.activeAccountCount > 0} />
          <StatChip label="并发" value={`${provider.inFlight}/${provider.totalMaxConcurrency}`} accent={provider.inFlight > 0} />
          <StatChip label="P" value={provider.priority} />
          <StatChip label="×" value={provider.costMultiplier} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button type="button" disabled={busy !== null} onClick={() => act("test", () => testAdminProvider(provider.id), "测试通过")}
            className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:border-accent/40 hover:text-accent disabled:opacity-40">
            {busy === "test" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            测试
          </button>
          <button type="button" onClick={() => setEditing((v) => !v)}
            className="flex h-7 items-center rounded-md border border-border px-2 text-[11px] text-text-muted hover:text-foreground">
            编辑
          </button>
          {provider.isActive && isDown && (
            <button type="button" disabled={busy !== null} onClick={() => act("restore", () => restoreAdminProvider(provider.id), "渠道已恢复")}
              className="flex h-7 items-center gap-1 rounded-md border border-success/30 px-2 text-[11px] text-success hover:bg-success/[0.06] disabled:opacity-40">
              {busy === "restore" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              恢复
            </button>
          )}
          <button type="button" disabled={busy !== null}
            onClick={() => {
              if (provider.isActive) {
                if (!window.confirm(`停用渠道「${provider.name}」及其全部账号？`)) return;
                act("disable", () => disableAdminProvider(provider.id), "已停用");
              } else {
                act("enable", () => restoreAdminProvider(provider.id), "渠道已恢复");
              }
            }}
            className={cn("flex h-7 items-center rounded-md border px-2 text-[11px] disabled:opacity-40",
              provider.isActive ? "border-danger/30 text-danger hover:bg-danger/[0.06]" : "border-success/30 text-success hover:bg-success/[0.06]")}>
            {provider.isActive ? "停用" : "启用"}
          </button>
        </div>
      </div>

      {/* Model tags */}
      {provider.modelsSupported.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-border/50 px-4 py-2">
          {provider.modelsSupported.map((id) => (
            <span key={id} className="rounded border border-border px-1.5 py-px font-mono text-[10px] text-text-faint">{id}</span>
          ))}
          {provider.note && <span className="ml-auto text-[11px] text-text-faint">{provider.note}</span>}
        </div>
      )}

      {/* Last error — always visible with timestamp */}
      {provider.lastErrorMsg && (
        <div className="border-t border-danger/20 bg-danger/[0.03] px-4 py-2">
          <div className="flex items-start gap-2">
            {provider.lastErrorAt && (
              <span className="mt-0.5 shrink-0 text-[10px] text-danger/60">
                {new Date(provider.lastErrorAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <p className="flex-1 text-[11px] text-danger">{provider.lastErrorMsg}</p>
          </div>
        </div>
      )}

      {editing && (
        <EditProviderForm
          provider={provider}
          onSave={(patch) => onRun(() => patchAdminProvider(provider.id, patch), "渠道已更新").then(() => setEditing(false))}
          onCancel={() => setEditing(false)}
        />
      )}

      {expanded && (
        <div className="border-t border-border/50 px-4 py-4">
          <ProviderAccounts providerId={provider.id} />
        </div>
      )}
    </div>
  );
}
