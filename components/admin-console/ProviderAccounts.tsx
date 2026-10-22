"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Upload,
} from "lucide-react";

import { Button, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

import {
  createAdminProviderAccount,
  disableAdminProviderAccount,
  importAdminProviderAccounts,
  isAdminApiError,
  listAdminProviderAccounts,
  patchAdminProviderAccount,
  restoreAdminProviderAccount,
  testAdminProviderAccount,
} from "./lib/api";
import type { AccountImportResult, AdminProviderAccount } from "./lib/types";
import { AdminField, EmptyPanel, ErrorText } from "./ui";

// ─── Health dot ───────────────────────────────────────────────────────────────

function HealthDot({ health }: { health: string }) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        health === "HEALTHY"
          ? "bg-success shadow-[0_0_0_3px] shadow-success/20"
          : health === "DEGRADED"
            ? "bg-warning"
            : "bg-danger",
      )}
    />
  );
}

// ─── Cooldown badge ───────────────────────────────────────────────────────────

function CooldownBadge({ until }: { until: string }) {
  const date = new Date(until);
  const now = Date.now();
  const remainMs = date.getTime() - now;
  if (remainMs <= 0) return null;
  const remainMin = Math.ceil(remainMs / 60_000);
  const label =
    remainMin < 60
      ? `冷却 ${remainMin}min`
      : `冷却 ${Math.ceil(remainMin / 60)}h`;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-warning/30 bg-warning/[0.07] px-1.5 py-px text-[10px] text-warning">
      <Clock className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProviderAccounts({ providerId }: { providerId: string }) {
  const [accounts, setAccounts] = useState<AdminProviderAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const reload = useCallback(() => {
    listAdminProviderAccounts(providerId)
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [providerId]);

  useEffect(reload, [reload]);

  async function run(action: () => Promise<unknown>, okMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okMessage);
      reload();
    } catch (err) {
      setError(isAdminApiError(err) ? err.message : "操作失败");
    }
  }

  if (!accounts) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg border border-border bg-foreground/[0.02]" />
        ))}
      </div>
    );
  }

  const coolingCount = accounts.filter(
    (a) => a.cooldownUntil && new Date(a.cooldownUntil) > new Date(),
  ).length;
  const downCount = accounts.filter((a) => a.health === "DOWN").length;

  return (
    <div className="space-y-3">
      <ErrorText message={error} />
      {notice && <p className="text-xs text-success">{notice}</p>}

      {/* Summary */}
      {accounts.length > 0 && (coolingCount > 0 || downCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {coolingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-warning/30 bg-warning/[0.06] px-2 py-0.5 text-xs text-warning">
              <Clock className="h-3 w-3" />
              {coolingCount} 个账号冷却中
            </span>
          )}
          {downCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-danger/30 bg-danger/[0.06] px-2 py-0.5 text-xs text-danger">
              <AlertTriangle className="h-3 w-3" />
              {downCount} 个账号 DOWN
            </span>
          )}
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyPanel text="该渠道还没有账号" />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              providerId={providerId}
              onRun={run}
            />
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => { setAddOpen((v) => !v); setImportOpen(false); }}
          className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:border-accent/40 hover:text-accent"
        >
          <Plus className="h-3 w-3" />
          添加账号
        </button>
        <button
          type="button"
          onClick={() => { setImportOpen((v) => !v); setAddOpen(false); }}
          className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:border-accent/40 hover:text-accent"
        >
          <Upload className="h-3 w-3" />
          批量导入
        </button>
      </div>

      {addOpen && (
        <AddAccountForm
          providerId={providerId}
          onRun={run}
          onClose={() => setAddOpen(false)}
        />
      )}
      {importOpen && (
        <ImportAccountsForm
          providerId={providerId}
          onRun={run}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Account row ──────────────────────────────────────────────────────────────

function AccountRow({
  account,
  providerId,
  onRun,
}: {
  account: AdminProviderAccount;
  providerId: string;
  onRun: (action: () => Promise<unknown>, okMessage: string) => Promise<void>;
}) {
  const [concurrency, setConcurrency] = useState(account.maxConcurrency);
  const [weight, setWeight] = useState(account.weight);
  const [busy, setBusy] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const act = (key: string, action: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    void onRun(action, ok).finally(() => setBusy(null));
  };

  const isCooling =
    !!account.cooldownUntil && new Date(account.cooldownUntil) > new Date();

  return (
    <div
      className={cn(
        "px-3 py-2.5 transition-colors",
        account.health === "DOWN" && "bg-danger/[0.025]",
        isCooling && account.health !== "DOWN" && "bg-warning/[0.02]",
      )}
    >
      {/* Main row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <HealthDot health={account.isActive ? account.health : "DOWN"} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate text-sm font-medium">
                {account.name ?? account.apiKeyFingerprintMasked}
              </span>
              {account.isDefault && (
                <span className="text-[10px] text-text-faint">默认</span>
              )}
              {!account.isActive && (
                <span className="rounded border border-danger/30 px-1 py-px text-[10px] text-danger">
                  停用
                </span>
              )}
              {isCooling && <CooldownBadge until={account.cooldownUntil!} />}
            </div>
            <span className="block truncate font-mono text-[10px] text-text-faint">
              {account.baseUrl}
            </span>
          </div>
        </div>

        {/* Live stats */}
        <div className="flex items-center gap-2 font-mono text-[11px] text-text-muted">
          <span title="并发中/最大并发">
            ⚡ {account.inFlight}/{account.maxConcurrency}
          </span>
          <span title="今日用量">
            📈 {account.dailyUsed}
            {account.dailyLimit ? `/${account.dailyLimit}` : ""}
          </span>
        </div>

        {/* Inline concurrency / weight */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-text-muted">
            并发
            <Input
              type="number"
              min={1}
              max={100}
              className="h-6 w-12 rounded border border-border bg-transparent px-1.5 font-mono text-xs outline-none focus:border-accent"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-1 text-[11px] text-text-muted">
            权重
            <Input
              type="number"
              min={1}
              max={100}
              className="h-6 w-12 rounded border border-border bg-transparent px-1.5 font-mono text-xs outline-none focus:border-accent"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            disabled={
              busy !== null ||
              (concurrency === account.maxConcurrency && weight === account.weight)
            }
            onClick={() =>
              act("save", () =>
                patchAdminProviderAccount(providerId, account.id, {
                  maxConcurrency: concurrency,
                  weight,
                }), "已保存")
            }
            className="flex h-6 items-center rounded border border-border px-1.5 text-[11px] text-text-muted hover:border-accent/40 hover:text-accent disabled:opacity-40"
          >
            {busy === "save" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "保存"}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              act("test", () => testAdminProviderAccount(providerId, account.id), "测试通过")
            }
            className="flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-text-muted hover:border-accent/40 hover:text-accent disabled:opacity-40"
            title="发起测试"
          >
            {busy === "test" ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Play className="h-2.5 w-2.5" />
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              act("restore", () => restoreAdminProviderAccount(providerId, account.id), "已清冷却")
            }
            className="flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-text-muted hover:border-success/40 hover:text-success disabled:opacity-40"
            title="清除冷却和错误计数"
          >
            {busy === "restore" ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <RotateCcw className="h-2.5 w-2.5" />
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              act("toggle", () =>
                patchAdminProviderAccount(providerId, account.id, {
                  isActive: !account.isActive,
                }), account.isActive ? "已停用" : "已启用")
            }
            className="flex h-6 items-center rounded border border-border px-1.5 text-[11px] text-text-muted hover:text-foreground disabled:opacity-40"
          >
            {account.isActive ? "停用" : "启用"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm("禁用该账号（置为 DOWN）？")) return;
              act("disable", () => disableAdminProviderAccount(providerId, account.id), "已禁用");
            }}
            className="flex h-6 items-center rounded border border-danger/30 px-1.5 text-[11px] text-danger hover:bg-danger/[0.06] disabled:opacity-40"
          >
            禁用
          </button>
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            className="flex h-6 items-center rounded border border-border px-1 text-[11px] text-text-faint hover:text-foreground"
            title="查看错误详情"
          >
            {detailOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Error detail (collapsible) */}
      {detailOpen && account.lastErrorMsg && (
        <p className="mt-2 rounded bg-danger/[0.04] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-danger">
          {account.lastErrorMsg}
        </p>
      )}
      {detailOpen && !account.lastErrorMsg && (
        <p className="mt-2 text-[11px] text-text-faint">暂无错误记录</p>
      )}
    </div>
  );
}

// ─── Add account form ─────────────────────────────────────────────────────────

function AddAccountForm({
  providerId,
  onRun,
  onClose,
}: {
  providerId: string;
  onRun: (action: () => Promise<unknown>, okMessage: string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    maxConcurrency: 1,
    weight: 1,
  });
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-3">
      <p className="mb-2.5 text-xs font-medium">添加账号</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <AdminField label="名称（可选）">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </AdminField>
        <AdminField label="Base URL">
          <Input
            placeholder="https://…"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </AdminField>
        <AdminField label="API Key" className="sm:col-span-2">
          <Input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </AdminField>
        <AdminField label="并发">
          <Input
            type="number"
            min={1}
            max={100}
            value={form.maxConcurrency}
            onChange={(e) => setForm({ ...form, maxConcurrency: Number(e.target.value) })}
          />
        </AdminField>
        <AdminField label="权重">
          <Input
            type="number"
            min={1}
            max={100}
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })}
          />
        </AdminField>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Button
          type="button"
          disabled={busy || !form.baseUrl.trim() || !form.apiKey.trim()}
          className="h-8 px-3 text-xs disabled:opacity-45"
          onClick={() => {
            setBusy(true);
            void onRun(
              () =>
                createAdminProviderAccount(providerId, {
                  name: form.name.trim() || undefined,
                  baseUrl: form.baseUrl.trim(),
                  apiKey: form.apiKey.trim(),
                  maxConcurrency: form.maxConcurrency,
                  weight: form.weight,
                }),
              "账号已添加",
            )
              .then(onClose)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          确认添加
        </Button>
        <Button type="button" className="h-8 px-3 text-xs text-text-muted" onClick={onClose}>
          取消
        </Button>
      </div>
    </div>
  );
}

// ─── Import accounts form ─────────────────────────────────────────────────────

function ImportAccountsForm({
  providerId,
  onRun,
  onClose,
}: {
  providerId: string;
  onRun: (action: () => Promise<unknown>, okMessage: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AccountImportResult | null>(null);

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-3">
      <p className="mb-1.5 text-xs font-medium">批量导入账号</p>
      <p className="mb-2 text-[11px] text-text-muted">
        每行一条：<code className="text-foreground">baseUrl, apiKey, 并发?, 权重?, 名称?</code>
      </p>
      <Textarea
        className="min-h-24 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-accent"
        placeholder="https://api.example.com, sk-xxx, 2, 1, 账号A"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {result && (
        <p className="mt-2 text-xs text-text-muted">
          新增 <span className="text-success">{result.created}</span> · 跳过{" "}
          {result.skipped} · 失败{" "}
          <span className={result.failed > 0 ? "text-danger" : ""}>{result.failed}</span>
          {result.errors.length > 0
            ? `（第 ${result.errors[0].lineNumber} 行：${result.errors[0].reason}）`
            : ""}
        </p>
      )}
      <div className="mt-2.5 flex gap-2">
        <Button
          type="button"
          disabled={busy || !text.trim()}
          className="h-8 px-3 text-xs disabled:opacity-45"
          onClick={() => {
            setBusy(true);
            setResult(null);
            void onRun(async () => {
              const r = await importAdminProviderAccounts(providerId, { mode: "lines", text });
              setResult(r);
            }, "导入完成").finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          开始导入
        </Button>
        <Button type="button" className="h-8 px-3 text-xs text-text-muted" onClick={onClose}>
          收起
        </Button>
      </div>
    </div>
  );
}
