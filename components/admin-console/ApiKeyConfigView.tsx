"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";

import { Button, Input, Textarea } from "@/components/ui";
import { ApiDocsContent } from "@/components/agent/ApiDocsContent";
import {
  MAX_DOCS_LENGTH,
  MODELS_PLACEHOLDER,
  type ApiDocsModel,
} from "@/lib/api-docs-shared";
import { cn } from "@/lib/utils";

import {
  getAdminApiKeyConfig,
  isAdminApiError,
  patchAdminApiKeyConfig,
  type ApiKeyAdminConfig,
  type ApiKeyAdminPatch,
  type ApiPriceTable,
  type ApiPriceTier,
} from "./lib/api";
import { AdminPageHeader, ErrorText } from "./ui";

const TIERS: ApiPriceTier[] = ["1K", "2K", "4K"];
const round2 = (value: number) => Math.round(value * 100) / 100;

type SaveFn = (patch: ApiKeyAdminPatch, okMessage: string) => Promise<boolean>;

export function ApiKeyConfigView() {
  const [config, setConfig] = useState<ApiKeyAdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    setError(null);
    getAdminApiKeyConfig()
      .then(setConfig)
      .catch((err) => setError(isAdminApiError(err) ? err.message : "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const save: SaveFn = async (patch, okMessage) => {
    setError(null);
    try {
      setConfig(await patchAdminApiKeyConfig(patch));
      setNotice(okMessage);
      setTimeout(() => setNotice(null), 3000);
      return true;
    } catch (err) {
      setError(isAdminApiError(err) ? err.message : "保存失败");
      return false;
    }
  };

  return (
    <div>
      <AdminPageHeader
        eyebrow="API Keys"
        title="API 配置"
        description="API 调用的独立定价、提交限速和对外文档"
        actions={
          <Button
            type="button"
            className="h-8 w-8 p-0 text-text-muted"
            onClick={reload}
            title="刷新"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        }
      />

      <ErrorText message={error} />
      {notice && <p className="mb-4 text-sm text-success">{notice}</p>}

      {loading && !config ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      ) : config ? (
        <div className="space-y-6">
          <RuntimeSection config={config} onSave={save} />
          <PriceSection config={config} onSave={save} />
          <DocsSection config={config} onSave={save} />
        </div>
      ) : null}
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{description}</p>
      </header>
      {children}
    </section>
  );
}

function SaveButton({
  dirty,
  busy,
  onClick,
  label = "保存",
}: {
  dirty: boolean;
  busy: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button
      type="button"
      disabled={busy || !dirty}
      className="h-8 px-4 text-sm disabled:opacity-40"
      onClick={onClick}
    >
      {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
      {label}
    </Button>
  );
}

// ─── Multiplier & rate limit ──────────────────────────────────────────────────

function RuntimeSection({ config, onSave }: { config: ApiKeyAdminConfig; onSave: SaveFn }) {
  const [multiplier, setMultiplier] = useState(String(config.creditMultiplier));
  const [rateLimit, setRateLimit] = useState(String(config.rateLimitPerMin));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMultiplier(String(config.creditMultiplier));
    setRateLimit(String(config.rateLimitPerMin));
  }, [config.creditMultiplier, config.rateLimitPerMin]);

  const nextMultiplier = Number(multiplier);
  const nextRateLimit = Number(rateLimit);
  const valid =
    Number.isFinite(nextMultiplier) &&
    nextMultiplier >= 0 &&
    Number.isInteger(nextRateLimit) &&
    nextRateLimit >= 1;
  const dirty =
    valid &&
    (nextMultiplier !== config.creditMultiplier ||
      nextRateLimit !== config.rateLimitPerMin);

  const rows = [
    {
      label: "默认倍率",
      hint: "下方价格表里没单独设价的格子，按「网页价 × 倍率」收费。1 = 与网页同价。",
      value: multiplier,
      onChange: setMultiplier,
      step: 0.05,
      unit: "×",
    },
    {
      label: "每分钟提交上限",
      hint: "每个用户通过 API 每分钟最多提交的任务数。并发上限在「用户」详情页按用户设置。",
      value: rateLimit,
      onChange: setRateLimit,
      step: 1,
      unit: "次/分",
    },
  ];

  return (
    <Panel title="基础设置" description="未单独定价时的默认倍率与提交限速">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{row.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{row.hint}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Input
              type="number"
              min={0}
              step={row.step}
              className="h-8 w-28 font-mono text-sm"
              value={row.value}
              onChange={(e) => row.onChange(e.target.value)}
            />
            <span className="w-10 text-xs text-text-muted">{row.unit}</span>
          </div>
        </div>
      ))}
      <div className="border-t border-border px-5 py-3">
        <SaveButton
          dirty={dirty}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(
              { creditMultiplier: nextMultiplier, rateLimitPerMin: nextRateLimit },
              "基础设置已保存",
            );
            setBusy(false);
          }}
        />
      </div>
    </Panel>
  );
}

// ─── API price grid ───────────────────────────────────────────────────────────

type PriceDraft = Record<string, Partial<Record<ApiPriceTier, string>>>;

function toDraft(prices: ApiPriceTable): PriceDraft {
  return Object.fromEntries(
    Object.entries(prices).map(([modelId, tiers]) => [
      modelId,
      Object.fromEntries(
        Object.entries(tiers).map(([tier, value]) => [tier, String(value)]),
      ),
    ]),
  );
}

function fromDraft(draft: PriceDraft): ApiPriceTable | null {
  const table: ApiPriceTable = {};
  for (const [modelId, tiers] of Object.entries(draft)) {
    for (const [tier, raw] of Object.entries(tiers)) {
      if (raw === undefined || raw.trim() === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return null;
      table[modelId] = { ...table[modelId], [tier]: value };
    }
  }
  return table;
}

function PriceSection({ config, onSave }: { config: ApiKeyAdminConfig; onSave: SaveFn }) {
  const [draft, setDraft] = useState<PriceDraft>(() => toDraft(config.prices));
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(toDraft(config.prices)), [config.prices]);

  const parsed = fromDraft(draft);
  const dirty =
    parsed !== null && JSON.stringify(parsed) !== JSON.stringify(config.prices);

  return (
    <Panel
      title="API 定价"
      description="单位：积分/张，按实际出图分辨率计费。留空 = 网页价 × 默认倍率（灰色为当前生效价）。只影响 API 调用，不影响网页端。"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">模型</th>
              {TIERS.map((tier) => (
                <th key={tier} className="px-3 py-2.5 text-left text-xs font-medium text-text-muted">
                  {tier}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {config.models.map((model) => (
              <tr key={model.id}>
                <td className="px-5 py-2.5">
                  <p className="font-medium">{model.displayName}</p>
                  <p className="font-mono text-[11px] text-text-faint">{model.id}</p>
                </td>
                {TIERS.map((tier) => {
                  const supported = model.resolutions.includes(tier);
                  const web = model.webPrices[tier];
                  const fallback =
                    web === undefined ? "" : String(round2(web * config.creditMultiplier));
                  return (
                    <td key={tier} className="px-3 py-2.5 align-top">
                      {supported ? (
                        <>
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            aria-label={`${model.displayName} ${tier} API 价格`}
                            placeholder={fallback}
                            className="h-8 w-24 font-mono text-xs"
                            value={draft[model.id]?.[tier] ?? ""}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [model.id]: { ...prev[model.id], [tier]: e.target.value },
                              }))
                            }
                          />
                          <p className="mt-1 text-[10px] text-text-faint">网页价 {web ?? "—"}</p>
                        </>
                      ) : (
                        <span className="text-xs text-text-faint">不支持</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t border-border px-5 py-3">
        <SaveButton
          dirty={dirty}
          busy={busy}
          label="保存定价"
          onClick={async () => {
            if (!parsed) return;
            setBusy(true);
            await onSave({ prices: parsed }, "API 定价已保存");
            setBusy(false);
          }}
        />
        {parsed === null && (
          <span className="text-xs text-danger">价格必须是不小于 0 的数字</span>
        )}
      </div>
    </Panel>
  );
}

// ─── Docs editor ──────────────────────────────────────────────────────────────

function DocsSection({ config, onSave }: { config: ApiKeyAdminConfig; onSave: SaveFn }) {
  const [text, setText] = useState(config.docsMarkdown);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [models, setModels] = useState<ApiDocsModel[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setText(config.docsMarkdown), [config.docsMarkdown]);

  useEffect(() => {
    if (mode !== "preview" || models) return;
    fetch("/api/public/api-docs")
      .then((res) => res.json())
      .then((body: { ok: boolean; data?: { models: ApiDocsModel[] } }) =>
        setModels(body.data?.models ?? []),
      )
      .catch(() => setModels([]));
  }, [mode, models]);

  const dirty = text !== config.docsMarkdown;
  const tooLong = text.length > MAX_DOCS_LENGTH;

  return (
    <Panel
      title="API 文档"
      description={`Markdown 格式，显示在用户「设置 → API 密钥」页。写 ${MODELS_PLACEHOLDER} 的那一行会自动替换成实时的模型、参数和价格表。`}
    >
      <div className="flex items-center gap-1 border-b border-border px-5 py-2">
        {(["edit", "preview"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium",
              mode === value
                ? "bg-foreground/10 text-foreground"
                : "text-text-muted hover:text-foreground",
            )}
          >
            {value === "edit" ? "编辑" : "预览"}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-text-faint">
          {config.docsIsDefault ? "当前使用内置默认文档" : "当前使用自定义文档"} · {text.length} 字
        </span>
      </div>

      {mode === "edit" ? (
        <div className="px-5 py-4">
          <Textarea
            aria-label="API 文档 Markdown"
            spellCheck={false}
            className="h-[520px] w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-accent"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto px-5 py-5">
          <ApiDocsContent markdown={text} models={models} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
        <SaveButton
          dirty={dirty && !tooLong}
          busy={busy}
          label="保存文档"
          onClick={async () => {
            setBusy(true);
            await onSave({ docsMarkdown: text }, "API 文档已保存");
            setBusy(false);
          }}
        />
        {!config.docsIsDefault && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("恢复为内置默认文档？当前自定义内容会被覆盖。")) return;
              setBusy(true);
              await onSave({ docsMarkdown: "" }, "已恢复默认文档");
              setBusy(false);
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" />
            恢复默认
          </button>
        )}
        {tooLong && (
          <span className="text-xs text-danger">文档不能超过 {MAX_DOCS_LENGTH} 字</span>
        )}
      </div>
    </Panel>
  );
}
