"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button, Input } from "@/components/ui";
import type { ModelInfo } from "@/components/studio/lib/types";

import {
  createAdminPricingRule,
  getAdminConversationPricing,
  getAdminPricing,
  isAdminApiError,
  patchAdminConversationPricing,
  patchAdminPricingRule,
} from "./lib/api";
import type { ConversationPricing, PricingRule } from "./lib/types";
import { AdminPageHeader, ErrorText } from "./ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "image" | "chat";

// resolution × mode → rule
type RuleGrid = Map<string, Map<string | null, PricingRule>>;

function buildGrid(rules: PricingRule[], modelId: string): RuleGrid {
  const grid: RuleGrid = new Map();
  for (const rule of rules) {
    if (rule.modelId !== modelId || !rule.isActive) continue;
    const res = rule.resolution ?? "auto";
    if (!grid.has(res)) grid.set(res, new Map());
    grid.get(res)!.set(rule.image2Mode, rule);
  }
  return grid;
}

const RESOLUTION_ORDER = ["auto", "1K", "2K", "4K", "High"];

function sortedResolutions(grid: RuleGrid): string[] {
  const all = Array.from(grid.keys());
  return all.sort(
    (a, b) =>
      (RESOLUTION_ORDER.indexOf(a) === -1
        ? 99
        : RESOLUTION_ORDER.indexOf(a)) -
      (RESOLUTION_ORDER.indexOf(b) === -1 ? 99 : RESOLUTION_ORDER.indexOf(b)),
  );
}

function modesForGrid(grid: RuleGrid): Array<string | null> {
  const modes = new Set<string | null>();
  for (const row of grid.values()) {
    for (const mode of row.keys()) modes.add(mode);
  }
  if (modes.size === 1 && modes.has(null)) return [null];
  return [null, "standard", "high"].filter((m) => modes.has(m));
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function PricingView() {
  const [tab, setTab] = useState<Tab>("image");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [pricing, setPricing] = useState<ConversationPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    Promise.all([getAdminPricing(), getAdminConversationPricing()])
      .then(([pd, cp]) => {
        setModels(pd.models);
        setRules(pd.rules);
        setPricing(cp);
      })
      .catch((err) =>
        setError(isAdminApiError(err) ? err.message : "加载失败"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="Pricing"
        title="定价管理"
        description="生图点数规则与对话计费"
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

      {notice && (
        <p className="mb-4 text-sm text-success">{notice}</p>
      )}

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-lg border border-border bg-surface p-1 w-fit">
        {(["image", "chat"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-foreground/10 text-foreground"
                : "text-text-muted hover:text-foreground"
            }`}
          >
            {t === "image" ? "生图定价" : "对话计费"}
          </button>
        ))}
      </div>

      {tab === "image" && (
        <ImagePricingTab
          models={models}
          rules={rules}
          onNotice={showNotice}
          onError={(msg) => setError(msg)}
          onRulesChange={setRules}
        />
      )}

      {tab === "chat" && pricing && (
        <ChatPricingTab
          pricing={pricing}
          onSave={async (next) => {
            await patchAdminConversationPricing(next);
            setPricing(next);
            showNotice("对话定价已保存");
          }}
        />
      )}
    </div>
  );
}

// ─── Image pricing tab ────────────────────────────────────────────────────────

function ImagePricingTab({
  models,
  rules,
  onNotice,
  onError,
  onRulesChange,
}: {
  models: ModelInfo[];
  rules: PricingRule[];
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
  onRulesChange: (rules: PricingRule[]) => void;
}) {
  return (
    <div className="space-y-6">
      {models.map((model) => {
        const modelRules = rules.filter((r) => r.modelId === model.id);
        return (
          <ModelPricingCard
            key={model.id}
            model={model}
            rules={modelRules}
            onNotice={onNotice}
            onError={onError}
            onRulesChange={(updated) => {
              onRulesChange(
                rules
                  .filter((r) => r.modelId !== model.id)
                  .concat(updated),
              );
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Per-model card ───────────────────────────────────────────────────────────

function ModelPricingCard({
  model,
  rules,
  onNotice,
  onError,
  onRulesChange,
}: {
  model: ModelInfo;
  rules: PricingRule[];
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
  onRulesChange: (rules: PricingRule[]) => void;
}) {
  const grid = buildGrid(rules, model.id);
  const resolutions = sortedResolutions(grid);
  const modes = modesForGrid(grid);
  const hasModes = modes.some((m) => m !== null);

  const modeLabel = (m: string | null) =>
    m === null ? "默认" : m === "standard" ? "标准" : "高质量";

  const handleSave = async (
    resolution: string,
    mode: string | null,
    credits: number,
  ) => {
    const existing = grid.get(resolution)?.get(mode);
    try {
      if (existing) {
        const updated = await patchAdminPricingRule(existing.id, { credits });
        onRulesChange(
          rules.map((r) => (r.id === existing.id ? { ...r, ...updated } : r)),
        );
      } else {
        const created = await createAdminPricingRule({
          modelId: model.id,
          resolution: resolution === "auto" ? null : resolution,
          image2Mode: mode as "standard" | "high" | null,
          credits,
          priority: 10,
        });
        onRulesChange([...rules, created as PricingRule]);
      }
      onNotice("已保存");
    } catch (err) {
      onError(isAdminApiError(err) ? err.message : "保存失败");
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <span className="font-medium">{model.displayName}</span>
          <span className="ml-2 font-mono text-xs text-text-faint">
            {model.id}
          </span>
        </div>
        <span className="text-xs text-text-muted">单位：积分 / 张</span>
      </div>

      {resolutions.length === 0 ? (
        <p className="px-5 py-4 text-sm text-text-muted">
          暂无活跃规则，使用系统默认成本
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">
                  分辨率
                </th>
                {modes.map((m) => (
                  <th
                    key={String(m)}
                    className="px-5 py-2.5 text-left text-xs font-medium text-text-muted"
                  >
                    {modeLabel(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resolutions.map((res) => (
                <tr key={res} className="hover:bg-foreground/[0.02]">
                  <td className="px-5 py-2 font-mono text-xs font-medium">
                    {res}
                  </td>
                  {modes.map((mode) => {
                    const rule = grid.get(res)?.get(mode);
                    return (
                      <td key={String(mode)} className="px-5 py-2">
                        <CreditCell
                          initialValue={rule?.credits ?? null}
                          onSave={(v) => handleSave(res, mode, v)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Inline credit cell ───────────────────────────────────────────────────────

function CreditCell({
  initialValue,
  onSave,
}: {
  initialValue: number | null;
  onSave: (value: number) => Promise<void>;
}) {
  const [value, setValue] = useState(
    initialValue !== null ? String(initialValue) : "",
  );
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setValue(initialValue !== null ? String(initialValue) : "");
    setDirty(false);
  }, [initialValue]);

  const commit = async () => {
    const n = Number(value);
    if (!dirty || !Number.isFinite(n) || n < 0) return;
    setBusy(true);
    try {
      await onSave(n);
      setDirty(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        value={value}
        placeholder="—"
        disabled={busy}
        className="h-7 w-20 rounded border border-border bg-transparent px-2 font-mono text-xs outline-none focus:border-accent disabled:opacity-50"
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
      />
      {busy && <Loader2 className="h-3 w-3 animate-spin text-text-muted" />}
      {dirty && !busy && (
        <span className="h-1.5 w-1.5 rounded-full bg-warning" title="未保存" />
      )}
    </div>
  );
}

// ─── Chat pricing tab ─────────────────────────────────────────────────────────

function ChatPricingTab({
  pricing,
  onSave,
}: {
  pricing: ConversationPricing;
  onSave: (next: ConversationPricing) => Promise<void>;
}) {
  const [form, setForm] = useState(pricing);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(pricing);
  }, [pricing]);

  const isDirty =
    form.standardCredits !== pricing.standardCredits ||
    form.reasoningCredits !== pricing.reasoningCredits;

  return (
    <div className="max-w-md rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-3">
        <span className="font-medium">对话计费</span>
        <p className="mt-0.5 text-xs text-text-muted">
          每次对话消耗的积分数。推理模式使用更多计算资源，单独定价。
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            标准对话（积分 / 次）
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step={0.5}
              className="h-8 w-32 font-mono text-sm"
              value={form.standardCredits}
              onChange={(e) =>
                setForm({ ...form, standardCredits: Number(e.target.value) })
              }
            />
            <span className="text-xs text-text-muted">积分 / 次</span>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            推理对话（积分 / 次）
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step={0.5}
              className="h-8 w-32 font-mono text-sm"
              value={form.reasoningCredits}
              onChange={(e) =>
                setForm({ ...form, reasoningCredits: Number(e.target.value) })
              }
            />
            <span className="text-xs text-text-muted">积分 / 次</span>
          </div>
        </div>

        <Button
          type="button"
          disabled={busy || !isDirty}
          className="mt-2 h-8 px-4 text-sm disabled:opacity-40"
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(form);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          保存
        </Button>
      </div>
    </div>
  );
}
