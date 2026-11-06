"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HEALTH_LABELS, healthLabel } from "@/lib/admin-labels";

import {
  patchJson,
  postJson,
  toDatetimeLocalValue,
} from "@/components/admin/admin-form-utils";

export type ProviderAccountRecord = {
  id: string;
  name: string | null;
  baseUrl: string;
  apiKeyFingerprintMasked: string;
  priority: number;
  weight: number;
  maxConcurrency: number;
  inFlight: number;
  health: "HEALTHY" | "DEGRADED" | "DOWN";
  isActive: boolean;
  consecutiveErrors: number;
  cooldownUntil: string | null;
  dailyLimit: number | null;
  dailyUsed: number;
  note: string | null;
  lastErrorMsg: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
};

export function ProviderAccountImportForm({
  providerId,
}: {
  providerId: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"csv" | "lines">("csv");
  const [text, setText] = useState("");
  const [csvText, setCsvText] = useState("");
  const [defaultMaxConcurrency, setDefaultMaxConcurrency] = useState(1);
  const [defaultWeight, setDefaultWeight] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sourceText = mode === "csv" ? csvText : text;
  const canSubmit = sourceText.trim().length > 0 && !isSubmitting;

  async function loadFile(file: File | null) {
    if (!file) {
      return;
    }

    const content = await file.text();
    setMode("csv");
    setCsvText(content);
    setMessage(`已载入 ${file.name}`);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("导入中...");

    try {
      const payload = (await postJson(
        `/api/admin/providers/${providerId}/accounts/import`,
        {
          mode,
          text: mode === "lines" ? text.trim() : undefined,
          csvText: mode === "csv" ? csvText.trim() : undefined,
          defaultMaxConcurrency,
          defaultWeight,
        },
      )) as {
        data?: { created: number; skipped: number; failed: number };
      };
      setText("");
      setCsvText("");
      setMessage(
        payload.data
          ? `已导入 ${payload.data.created}，跳过 ${payload.data.skipped}，失败 ${payload.data.failed}`
          : "账号已导入",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">导入</p>
          <p className="admin-section-title mt-1">批量导入账号</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            CSV 直接支持 `name,status,api_key,id,error`；高级模式保留逐行导入。
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-border bg-surface-2/60 p-1">
          <button
            className={`rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition-colors ${
              mode === "csv"
                ? "bg-surface text-foreground shadow-xs"
                : "text-text-muted hover:text-foreground"
            }`}
            type="button"
            aria-pressed={mode === "csv"}
            onClick={() => setMode("csv")}
          >
            CSV
          </button>
          <button
            className={`rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition-colors ${
              mode === "lines"
                ? "bg-surface text-foreground shadow-xs"
                : "text-text-muted hover:text-foreground"
            }`}
            type="button"
            aria-pressed={mode === "lines"}
            onClick={() => setMode("lines")}
          >
            逐行
          </button>
        </div>
      </div>
      {mode === "csv" ? (
        <div className="mt-3 space-y-3">
          <input
            className="block w-full text-sm text-text-muted file:mr-4 file:rounded-[6px] file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              void loadFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          <textarea
            className="min-h-32 w-full rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            placeholder="粘贴 CSV 内容，列头包含 name,status,api_key,id,error"
            required
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
          />
        </div>
      ) : (
        <textarea
          className="mt-3 min-h-28 w-full rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="每行：baseUrl apiKey maxConcurrency weight name"
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <div className="mt-3 grid items-end gap-3 sm:grid-cols-[160px_160px_auto]">
        <label className="grid gap-1">
          <span className="field-label">默认并发</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={1}
            max={100}
            value={defaultMaxConcurrency}
            onChange={(event) =>
              setDefaultMaxConcurrency(Number(event.target.value))
            }
            aria-label="默认并发"
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">默认权重</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={1}
            max={100}
            value={defaultWeight}
            onChange={(event) => setDefaultWeight(Number(event.target.value))}
            aria-label="默认权重"
          />
        </label>
        <button
          className="tool-button h-10"
          type="submit"
          disabled={!canSubmit}
        >
          导入
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {message ? (
          <span className="text-sm text-text-muted">{message}</span>
        ) : null}
        {!message && sourceText ? (
          <span className="text-xs text-text-muted">
            待处理 {sourceText.split(/\r?\n/).filter(Boolean).length} 行
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function ProviderAccountCreateForm({
  providerId,
  defaultBaseUrl,
  compact = false,
}: {
  providerId: string;
  defaultBaseUrl: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(0);
  const [weight, setWeight] = useState(1);
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [dailyLimit, setDailyLimit] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit =
    baseUrl.trim().length > 0 && apiKey.trim().length > 0 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("添加中...");

    try {
      await postJson(`/api/admin/providers/${providerId}/accounts`, {
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        priority,
        weight,
        maxConcurrency,
        dailyLimit: dailyLimit.trim() ? Number(dailyLimit) : undefined,
        note: note.trim() || undefined,
      });
      setName("");
      setApiKey("");
      setDailyLimit("");
      setNote("");
      setMessage("账号已添加");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={compact ? "space-y-3" : "surface-panel p-5"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {!compact ? <p className="eyebrow">新增</p> : null}
          <p className="admin-section-title mt-1">
            {compact ? "新增账号" : "新增池内账号"}
          </p>
          {!compact ? (
            <p className="mt-1 text-xs text-text-muted">
              账号名称用于后台识别，前台会自动显示为动物通道代称。
            </p>
          ) : null}
        </div>
        <button
          className="tool-button h-10"
          type="submit"
          disabled={!canSubmit}
        >
          添加账号
        </button>
      </div>
      <div
        className={
          compact
            ? "grid gap-3 lg:grid-cols-2"
            : "mt-4 grid gap-3 lg:grid-cols-3"
        }
      >
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="账号名称（如 imagegen-021）"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="Base URL"
          required
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <input
          className={
            compact
              ? "rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
              : "rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-3"
          }
          placeholder="API Key"
          required
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0}
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={weight}
          onChange={(event) => setWeight(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={maxConcurrency}
          onChange={(event) => setMaxConcurrency(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          placeholder="每日限额（可空）"
          value={dailyLimit}
          onChange={(event) => setDailyLimit(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="备注"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </form>
  );
}

export function ProviderAccountEditForm({
  providerId,
  account,
}: {
  providerId: string;
  account: ProviderAccountRecord;
}) {
  const router = useRouter();
  const [name, setName] = useState(account.name ?? "");
  const [baseUrl, setBaseUrl] = useState(account.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(account.priority);
  const [weight, setWeight] = useState(account.weight);
  const [maxConcurrency, setMaxConcurrency] = useState(account.maxConcurrency);
  const [dailyLimit, setDailyLimit] = useState(
    account.dailyLimit ? String(account.dailyLimit) : "",
  );
  const [note, setNote] = useState(account.note ?? "");
  const [isActive, setIsActive] = useState(account.isActive);
  const [health, setHealth] = useState(account.health);
  const [cooldownUntil, setCooldownUntil] = useState(
    toDatetimeLocalValue(account.cooldownUntil),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save() {
    setIsSubmitting(true);
    setMessage("保存中...");

    try {
      await patchJson(
        `/api/admin/providers/${providerId}/accounts/${account.id}`,
        {
          name: name.trim() || null,
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
          priority,
          weight,
          maxConcurrency,
          dailyLimit: dailyLimit.trim() ? Number(dailyLimit) : null,
          note: note.trim() || null,
          isActive,
          health,
          cooldownUntil: cooldownUntil
            ? new Date(cooldownUntil).toISOString()
            : null,
        },
      );
      setApiKey("");
      setMessage("账号已更新");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function testAccount() {
    setIsSubmitting(true);
    setMessage("测试中...");

    try {
      await postJson(
        `/api/admin/providers/${providerId}/accounts/${account.id}/test`,
        {},
      );
      setMessage("测试通过");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function quickPatch(body: unknown, successMessage: string) {
    setIsSubmitting(true);
    setMessage("处理中...");

    try {
      await patchJson(
        `/api/admin/providers/${providerId}/accounts/${account.id}`,
        body,
      );
      setMessage(successMessage);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  const accountHealthTone =
    account.health === "HEALTHY"
      ? "admin-status-healthy"
      : account.health === "DEGRADED"
        ? "admin-status-degraded"
        : "admin-status-down";

  return (
    <details
      className="admin-collapsible surface-panel p-4"
      open={account.health !== "HEALTHY"}
    >
      <summary>
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="admin-section-title">
                {account.name || account.baseUrl}
              </p>
              {account.isDefault ? (
                <span className="admin-pill">默认账号</span>
              ) : null}
              <span className="admin-pill admin-pill-mono">
                指纹 {account.apiKeyFingerprintMasked}
              </span>
            </div>
            <p className="mt-1.5 break-all font-mono text-xs text-text-muted">
              {account.baseUrl}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-text-muted">
            <span className={`admin-status ${accountHealthTone}`}>
              {account.isActive ? "启用" : "停用"} · {healthLabel(account.health)}
            </span>
            <span className="admin-pill">
              并发 {account.inFlight}/{account.maxConcurrency}
            </span>
            <span className="admin-pill">
              今日 {account.dailyUsed}/{account.dailyLimit ?? "∞"}
            </span>
          </div>
        </div>
      </summary>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="账号名称（如 imagegen-021）"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="Base URL"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-3"
          placeholder="留空则不改 API Key"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0}
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={weight}
          onChange={(event) => setWeight(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={maxConcurrency}
          onChange={(event) => setMaxConcurrency(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          placeholder="每日限额"
          value={dailyLimit}
          onChange={(event) => setDailyLimit(event.target.value)}
        />
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={health}
          onChange={(event) =>
            setHealth(event.target.value as ProviderAccountRecord["health"])
          }
        >
          <option value="HEALTHY">{HEALTH_LABELS.HEALTHY}</option>
          <option value="DEGRADED">{HEALTH_LABELS.DEGRADED}</option>
          <option value="DOWN">{HEALTH_LABELS.DOWN}</option>
        </select>
        <label className="flex items-center gap-2 rounded-[6px] border border-border bg-surface px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          启用账号
        </label>
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          type="datetime-local"
          value={cooldownUntil}
          onChange={(event) => setCooldownUntil(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-3"
          placeholder="备注"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="admin-metric">
          <dt className="admin-metric-label">错误次数</dt>
          <dd className="admin-metric-value">{account.consecutiveErrors}</dd>
        </div>
        <div className="admin-metric">
          <dt className="admin-metric-label">有无密钥</dt>
          <dd className="admin-metric-value">
            {account.hasApiKey ? "有" : "无"}
          </dd>
        </div>
        <div className="admin-metric min-w-0">
          <dt className="admin-metric-label">最近错误</dt>
          <dd className="admin-metric-value break-words text-xs leading-4">
            {account.lastErrorMsg ?? "-"}
          </dd>
        </div>
        <div className="admin-metric">
          <dt className="admin-metric-label">冷却至</dt>
          <dd className="admin-metric-value text-xs">
            {account.cooldownUntil ?? "-"}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <button
          className="tool-button h-10"
          type="button"
          disabled={isSubmitting}
          onClick={() => void save()}
        >
          保存账号
        </button>
        <button
          className="tool-button h-10 text-text-muted"
          type="button"
          disabled={isSubmitting}
          onClick={() => void testAccount()}
        >
          测试
        </button>
        <button
          className="tool-button h-10 text-text-muted"
          type="button"
          disabled={isSubmitting}
          onClick={() =>
            void quickPatch(
              {
                health: "HEALTHY",
                isActive: true,
                cooldownUntil: null,
                consecutiveErrors: 0,
              },
              "已清冷却并恢复健康",
            )
          }
        >
          清冷却
        </button>
        <button
          className="tool-button h-10 text-danger"
          type="button"
          disabled={isSubmitting}
          onClick={() =>
            void quickPatch(
              account.isActive
                ? { isActive: false, health: "DOWN" }
                : {
                    isActive: true,
                    health: "HEALTHY",
                    cooldownUntil: null,
                    consecutiveErrors: 0,
                  },
              account.isActive ? "账号已停用" : "账号已恢复",
            )
          }
        >
          {account.isActive ? "停用" : "恢复"}
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </details>
  );
}
