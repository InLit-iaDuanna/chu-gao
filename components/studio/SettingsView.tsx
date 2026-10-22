"use client";

import { AgentAccessSection } from "@/components/agent/AgentAccessSection";
import { ApiKeySection } from "@/components/agent/ApiKeySection";
import { Button } from "@/components/ui";

import { Input, Select, Skeleton } from "@/components/ui";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, LogOut, RotateCcw, Ticket } from "lucide-react";

import {
  ACCENT_PRESETS,
  accentFromHex,
  applyAccent,
  readAccent,
  type AccentChoice,
} from "@/lib/accent-color";
import { IMAGE_SIZE_LABEL } from "@/lib/models/options";
import type { ImageSize } from "@/lib/models/types";
import { cn, formatDate } from "@/lib/utils";
import {
  readWorkbenchPreferences,
  writeWorkbenchPreferences,
} from "@/lib/workbench-preferences";

import { isApiError, listUsageLog, logout, redeemCode } from "./lib/api";
import type { UsageLogEntry } from "./lib/types";

interface PreferenceModel {
  id: string;
  displayName: string;
  capabilities: { sizes: string[] };
  defaults: { size: string };
}

interface SettingsViewProps {
  user: {
    email: string;
    credits: number;
    dailyUsed: number;
    dailyLimit: number | null;
  };
  models: PreferenceModel[];
}

export function SettingsView({ user, models }: SettingsViewProps) {
  const router = useRouter();

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-panel p-6">
          <p className="eyebrow">账户</p>
          <h2 className="mt-2 text-xl font-semibold">个人资料</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div>
              <dt className="text-text-muted">邮箱</dt>
              <dd className="mt-1">{user.email}</dd>
            </div>
            <div>
              <dt className="text-text-muted">余额</dt>
              <dd className="mt-1 font-mono">{user.credits} 点</dd>
            </div>
            <div>
              <dt className="text-text-muted">今日用量</dt>
              <dd className="mt-1 font-mono">
                {user.dailyUsed} / {user.dailyLimit ?? "不限"}
              </dd>
            </div>
          </dl>

          <RedeemSection onRedeemed={() => router.refresh()} />

          <div className="mt-8 border-t border-border pt-5">
            <LogoutButton />
          </div>
        </section>

        <div className="grid gap-6">
          <PreferencesSection models={models} />
          <AppearanceSection />
        </div>
      </div>

      <AgentAccessSection />
      <ApiKeySection />
      <UsageSection />
    </div>
  );
}

function RedeemSection({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function handleRedeem() {
    const trimmed = code.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setMessage(null);

    try {
      const result = await redeemCode(trimmed);
      setMessage({
        tone: "success",
        text: `兑换成功 +${result.credits} 点，当前余额 ${result.balance} 点`,
      });
      setCode("");
      onRedeemed();
    } catch (error) {
      setMessage({
        tone: "error",
        text: isApiError(error) ? error.message : "兑换失败，请稍后再试",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      <p className="field-label">兑换码</p>
      <div className="mt-2 flex gap-2">
        <Input
          className="surface-panel-soft h-10 flex-1 px-3 font-mono text-sm outline-none placeholder:text-text-faint"
          placeholder="输入兑换码"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleRedeem();
          }}
        />
        <Button
          variant="secondary"
          type="button"
          className="h-10 px-4 text-text-muted disabled:opacity-45"
          disabled={!code.trim() || busy}
          onClick={() => void handleRedeem()}
        >
          <Ticket className="h-4 w-4 stroke-[1.5]" />
          {busy ? "兑换中…" : "兑换"}
        </Button>
      </div>
      {message ? (
        <p
          className={cn(
            "mt-2 text-xs",
            message.tone === "success" ? "text-success" : "text-danger",
          )}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

const USAGE_ACTION_LABEL: Record<string, string> = {
  generate: "生成扣点",
  refund: "退款返还",
  redeem_code: "兑换码充值",
  moderation_rejected: "审核拦截",
  pricing_adjustment_skipped: "价格调整",
  admin_credit_recharge: "管理员充值",
  admin_credit_adjust: "管理员调整",
};

const USAGE_REASON_LABEL: Record<string, string> = {
  generation_failed: "生成失败",
  queue_failed: "队列故障",
  canceled: "主动取消",
  successful_image_count: "按实际出图结算",
  stuck_generation: "任务超时终止",
  stuck_generation_invalid_request: "历史参数不可恢复",
  stuck_generation_unsupported_request: "模型已不可用",
  provider_content_rejected: "提供商内容拦截",
  insufficient_balance_for_auto_actual_size: "余额不足，按预估结算",
  auto_actual_size: "按实际出图补扣",
};

function UsageSection() {
  const [items, setItems] = useState<UsageLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    listUsageLog({ limit: 20 })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);
    setLoadMoreFailed(false);

    try {
      const page = await listUsageLog({ limit: 20, cursor: nextCursor });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="surface-panel p-6">
      <p className="eyebrow">流水</p>
      <h2 className="mt-2 text-xl font-semibold">积分流水</h2>
      <p className="mt-3 text-sm leading-6 text-text-muted">
        每次扣点、返还与充值都会记录在这里。
      </p>

      {state === "loading" ? (
        <div className="mt-6 flex flex-col gap-2">
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ) : state === "error" ? (
        <p className="mt-6 text-sm text-text-muted">
          流水读取失败，请稍后刷新重试。
        </p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">暂无记录。</p>
      ) : (
        <ul className="mt-6 divide-y divide-border">
          {items.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-4 py-2.5 text-sm"
            >
              <span className="w-28 shrink-0 text-xs text-text-faint">
                {formatDate(entry.createdAt)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {USAGE_ACTION_LABEL[entry.action] ?? entry.action}
                {entry.source === "agent" ? <span className="ml-2 text-xs text-text-muted">Agent</span> : null}
                {entry.reason && USAGE_REASON_LABEL[entry.reason] ? (
                  <span className="ml-2 text-xs text-text-faint">
                    {USAGE_REASON_LABEL[entry.reason]}
                  </span>
                ) : null}
                {entry.modelId ? (
                  <span className="ml-2 text-xs text-text-faint">
                    {entry.modelId}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono tabular-nums",
                  entry.creditsDelta > 0
                    ? "text-success"
                    : entry.creditsDelta < 0
                      ? "text-foreground"
                      : "text-text-faint",
                )}
              >
                {entry.creditsDelta > 0
                  ? `+${entry.creditsDelta}`
                  : entry.creditsDelta}
              </span>
            </li>
          ))}
        </ul>
      )}

      {state === "ready" && nextCursor ? (
        <div className="mt-4">
          <Button
            variant="secondary"
            type="button"
            className="h-9 w-full text-text-muted"
            loading={loadingMore}
            onClick={() => void handleLoadMore()}
          >
            {loadMoreFailed ? "加载失败，点击重试" : "加载更多"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
    } catch {
      // Keep the session cookie so the user can retry when the auth database
      // becomes available again.
      setBusy(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button
      variant="secondary"
      type="button"
      className="h-10 text-danger disabled:opacity-45"
      disabled={busy}
      onClick={() => void handleLogout()}
    >
      <LogOut className="h-4 w-4 stroke-[1.5]" />
      {busy ? "退出中…" : "退出登录"}
    </Button>
  );
}

function AppearanceSection() {
  const [active, setActive] = useState<AccentChoice | null>(null);
  const [customHex, setCustomHex] = useState("#60a5fa");

  useEffect(() => {
    setActive(readAccent());
  }, []);

  const choose = (choice: AccentChoice | null) => {
    applyAccent(choice);
    setActive(choice);
  };

  const customChoice = accentFromHex(customHex);

  return (
    <section className="surface-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">外观</p>
          <h2 className="mt-2 text-xl font-semibold">主题色</h2>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            强调色用于按钮、选中态与进度条，即时生效并保存到当前浏览器。
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          className="h-9 text-text-muted"
          onClick={() => choose(null)}
          disabled={!active}
        >
          <RotateCcw className="h-4 w-4 stroke-[1.5]" />
          恢复单色
        </Button>
      </div>

      <div className="mt-6 grid gap-4">
        <div>
          <span className="field-label">预设</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => choose(null)}
              className={cn(
                "flex h-9 items-center gap-2 rounded-md border px-3 text-xs transition-colors",
                !active
                  ? "border-brand/60 bg-brand/10 text-foreground"
                  : "border-border text-text-muted hover:border-border-strong hover:text-foreground",
              )}
            >
              <span className="h-3.5 w-3.5 rounded-full border border-border-strong bg-foreground" />
              单色（默认）
            </Button>
            {ACCENT_PRESETS.map((preset) => (
              <Button
                variant="ghost"
                key={preset.id}
                type="button"
                onClick={() => choose(preset)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border px-3 text-xs transition-colors",
                  active?.id === preset.id
                    ? "border-brand/60 bg-brand/10 text-foreground"
                    : "border-border text-text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full"
                  style={{ background: `rgb(${preset.primary})` }}
                />
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <span className="field-label">自定义</span>
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="color"
              value={customHex}
              onChange={(event) => setCustomHex(event.target.value)}
              aria-label="选择自定义颜色"
              className="h-9 w-12 cursor-pointer rounded-md border border-border bg-surface p-1"
            />
            <Input
              value={customHex}
              onChange={(event) => setCustomHex(event.target.value)}
              spellCheck={false}
              className="surface-panel-soft h-9 w-28 px-3 font-mono text-sm outline-none placeholder:text-text-faint"
              placeholder="#60a5fa"
            />
            <Button
              variant="secondary"
              type="button"
              className="h-9 px-3 text-text-muted disabled:opacity-45"
              disabled={!customChoice}
              onClick={() => customChoice && choose(customChoice)}
            >
              应用
            </Button>
            {active?.id.startsWith("custom-") ? (
              <span className="flex items-center gap-1 text-xs text-success">
                <Check className="h-3.5 w-3.5" />
                当前使用
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <span className="text-xs text-text-muted">预览</span>
          <span className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-on-accent">
            主要按钮
          </span>
          <span className="rounded-md border border-brand/60 bg-brand/10 px-2.5 py-1 text-xs text-foreground">
            选中态
          </span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-border">
            <span className="block h-full w-2/3 rounded-full bg-brand" />
          </span>
        </div>
      </div>
    </section>
  );
}

function PreferencesSection({ models }: { models: PreferenceModel[] }) {
  const [form, setForm] = useState(() => {
    const first = models[0] ?? null;
    const saved = readWorkbenchPreferences();
    const selected =
      (saved.modelId
        ? models.find((item) => item.id === saved.modelId)
        : null) ?? first;

    if (!selected) return { modelId: "", size: "auto" };

    return {
      modelId: selected.id,
      size:
        saved.size && selected.capabilities.sizes.includes(saved.size)
          ? saved.size
          : selected.defaults.size,
    };
  });
  const [saved, setSaved] = useState(false);

  const selectedModel =
    models.find((item) => item.id === form.modelId) ?? models[0] ?? null;

  function handleSave() {
    writeWorkbenchPreferences({ modelId: form.modelId, size: form.size });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  return (
    <section className="surface-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">偏好</p>
          <h2 className="mt-2 text-xl font-semibold">工作台默认项</h2>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            保存到当前浏览器，工作台下次打开时会自动读取这些默认值。
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          className="h-9 text-text-muted"
          onClick={handleSave}
        >
          {saved ? (
            <>
              <Check className="h-4 w-4 stroke-[1.5] text-success" />
              已保存
            </>
          ) : (
            "保存"
          )}
        </Button>
      </div>

      <div className="mt-6 grid gap-4">
        <label className="block space-y-2">
          <span className="field-label">默认模型</span>
          <Select
            aria-label="默认模型"
            controlSize="lg"
            value={form.modelId}
            onValueChange={(value) => {
              const next = models.find((item) => item.id === value);
              if (!next) return;
              setForm({ modelId: next.id, size: next.defaults.size });
            }}
            options={models.map((model) => ({
              value: model.id,
              label: model.displayName,
            }))}
          />
        </label>

        <label className="block space-y-2">
          <span className="field-label">默认尺寸</span>
          <Select
            aria-label="默认尺寸"
            controlSize="lg"
            value={form.size}
            onValueChange={(value) =>
              setForm((current) => ({ ...current, size: value }))
            }
            options={(selectedModel?.capabilities.sizes ?? []).map((size) => ({
              value: size,
              label: IMAGE_SIZE_LABEL[size as ImageSize] ?? size,
            }))}
          />
        </label>
      </div>
    </section>
  );
}
