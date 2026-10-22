"use client";

import { Button, Input, Select } from "@/components/ui";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";

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
import {
  AdminField,
  AdminPageHeader,
  AdminTable,
  EmptyPanel,
  ErrorText,
} from "./ui";

export function PricingView() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [pricing, setPricing] = useState<ConversationPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([getAdminPricing(), getAdminConversationPricing()])
      .then(([pricingData, conversationPricing]) => {
        setModels(pricingData.models);
        setRules(pricingData.rules);
        setPricing(conversationPricing);
        setPricingError(null);
      })
      .catch((err) => {
        setPricingError(
          err instanceof Error ? err.message : "定价数据加载失败",
        );
      })
      .finally(() => setLoading(false));
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

  if (loading) {
    return <div className="surface-panel h-64 animate-pulse" />;
  }

  const rulesByModel = new Map<string, PricingRule[]>();
  for (const rule of rules) {
    const list = rulesByModel.get(rule.modelId) ?? [];
    list.push(rule);
    rulesByModel.set(rule.modelId, list);
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="Pricing"
        title="定价"
        description="模型出图点数规则与对话计费"
        actions={
          <Button
            type="button"
            className="h-9 px-3 text-xs text-text-muted"
            onClick={() => setCreating((value) => !value)}
          >
            <Plus className="h-3.5 w-3.5 stroke-[1.5]" />
            新建规则
          </Button>
        }
      />

      <ErrorText message={error} />
      {notice ? <p className="mb-3 text-sm text-success">{notice}</p> : null}

      {creating ? (
        <CreateRuleForm
          models={models}
          onCreate={(input) =>
            run(() => createAdminPricingRule(input), "规则已创建").then(() =>
              setCreating(false),
            )
          }
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {pricing ? (
        <ConversationPricingSection
          pricing={pricing}
          onSave={(next) =>
            run(() => patchAdminConversationPricing(next), "对话定价已保存")
          }
        />
      ) : pricingError ? (
        <div className="surface-panel mb-6 p-4">
          <p className="eyebrow">对话计费</p>
          <p className="mt-2 text-sm text-danger">加载失败：{pricingError}</p>
          <Button type="button" className="mt-3 h-8 px-3 text-xs text-text-muted" onClick={reload}>
            重试
          </Button>
        </div>
      ) : null}

      {models.length === 0 ? (
        <EmptyPanel text="没有已配置的模型" />
      ) : (
        models.map((model) => {
          const modelRules = rulesByModel.get(model.id) ?? [];

          return (
            <section key={model.id} className="mb-6">
              <div className="mb-2 flex items-baseline gap-3">
                <h2 className="text-sm font-semibold">{model.displayName}</h2>
                <span className="font-mono text-[11px] text-text-faint">
                  {model.id}
                </span>
              </div>
              {modelRules.length === 0 ? (
                <p className="surface-panel-soft px-4 py-3 text-xs text-text-muted">
                  暂无规则，使用系统默认成本
                </p>
              ) : (
                <AdminTable head={["条件", "点数", "优先级", "状态", "操作"]}>
                  {modelRules.map((rule) => (
                    <RuleRow
                      key={rule.id}
                      model={model}
                      rule={rule}
                      onToggle={() =>
                        run(
                          () =>
                            patchAdminPricingRule(rule.id, {
                              isActive: !rule.isActive,
                            }),
                          rule.isActive ? "已停用" : "已启用",
                        )
                      }
                      onSaveCredits={(credits) =>
                        run(
                          () => patchAdminPricingRule(rule.id, { credits }),
                          "点数已更新",
                        )
                      }
                    />
                  ))}
                </AdminTable>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function channelName(model: ModelInfo, providerChannelId?: string | null) {
  if (!providerChannelId) {
    return "全部渠道";
  }

  return (
    model.providerChannels?.find((channel) => channel.id === providerChannelId)
      ?.displayName ?? providerChannelId
  );
}

function ruleCondition(rule: PricingRule, model: ModelInfo): string {
  const parts: string[] = [];
  parts.push(`渠道 ${channelName(model, rule.providerChannelId)}`);
  if (rule.image2Mode) parts.push(`模式 ${rule.image2Mode}`);
  if (rule.resolution) parts.push(`分辨率 ${rule.resolution}`);
  if (rule.aspectRatio) parts.push(`比例 ${rule.aspectRatio}`);
  if (rule.outputFormat) parts.push(`格式 ${rule.outputFormat}`);
  if (rule.background) parts.push(`背景 ${rule.background}`);
  if (rule.usesReference !== null && rule.usesReference !== undefined) {
    parts.push(rule.usesReference ? "带参考图" : "无参考图");
  }
  return parts.length > 0 ? parts.join(" · ") : "默认规则";
}

function RuleRow({
  model,
  rule,
  onToggle,
  onSaveCredits,
}: {
  model: ModelInfo;
  rule: PricingRule;
  onToggle: () => Promise<void>;
  onSaveCredits: (credits: number) => Promise<void>;
}) {
  const [credits, setCredits] = useState(rule.credits);
  const [busy, setBusy] = useState(false);

  // Sync input when rule reloads from server (e.g. after another field saves)
  useEffect(() => {
    setCredits(rule.credits);
  }, [rule.credits]);

  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-4 py-2.5 text-xs">{ruleCondition(rule, model)}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={0}
            className="h-7 w-20 rounded-md border border-border bg-surface px-1.5 font-mono text-xs outline-none"
            value={credits}
            onChange={(event) => setCredits(Number(event.target.value))}
          />
          <Button
            type="button"
            className="h-7 px-2 text-[11px] text-text-muted disabled:opacity-40"
            disabled={busy || credits === rule.credits}
            onClick={() => {
              setBusy(true);
              void onSaveCredits(credits).finally(() => setBusy(false));
            }}
          >
            存
          </Button>
        </div>
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
        {rule.priority}
      </td>
      <td className="px-4 py-2.5">
        {rule.isActive ? (
          <span className="text-xs text-success">启用</span>
        ) : (
          <span className="text-xs text-text-faint">停用</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <Button
          type="button"
          className="h-7 px-2 text-[11px] text-text-muted disabled:opacity-40"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onToggle().finally(() => setBusy(false));
          }}
        >
          {rule.isActive ? "停用" : "启用"}
        </Button>
      </td>
    </tr>
  );
}

function ConversationPricingSection({
  pricing,
  onSave,
}: {
  pricing: ConversationPricing;
  onSave: (next: ConversationPricing) => Promise<void>;
}) {
  const [form, setForm] = useState(pricing);
  const [busy, setBusy] = useState(false);

  // Keep local form in sync when parent reloads fresh data from the server
  useEffect(() => {
    setForm(pricing);
  }, [pricing]);

  return (
    <section className="surface-panel mb-6 p-4">
      <p className="eyebrow">对话计费</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <AdminField label="标准对话（点/次）">
          <Input
            type="number"
            min={0}
            step={0.5}
            className="w-32"
            value={form.standardCredits}
            onChange={(event) =>
              setForm({ ...form, standardCredits: Number(event.target.value) })
            }
          />
        </AdminField>
        <AdminField label="推理对话（点/次）">
          <Input
            type="number"
            min={0}
            step={0.5}
            className="w-32"
            value={form.reasoningCredits}
            onChange={(event) =>
              setForm({ ...form, reasoningCredits: Number(event.target.value) })
            }
          />
        </AdminField>
        <Button
          type="button"
          className="h-9 px-4 text-text-muted disabled:opacity-45"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onSave(form).finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          保存对话定价
        </Button>
      </div>
    </section>
  );
}

function CreateRuleForm({
  models,
  onCreate,
  onCancel,
}: {
  models: ModelInfo[];
  onCreate: (input: {
    modelId: string;
    providerChannelId?: string | null;
    image2Mode?: "standard" | "high" | null;
    resolution?: string | null;
    credits: number;
    priority?: number;
    note?: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    modelId: models[0]?.id ?? "",
    providerChannelId: "",
    image2Mode: "",
    resolution: "",
    credits: 10,
    priority: 0,
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const selectedModel =
    models.find((model) => model.id === form.modelId) ?? models[0] ?? null;
  const providerChannels = selectedModel?.providerChannels ?? [];

  return (
    <div className="surface-panel mb-6 space-y-3 p-4">
      <p className="text-sm font-medium">新建定价规则</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <AdminField label="模型">
          <Select
            aria-label="模型"
            value={form.modelId}
            onValueChange={(value) =>
              setForm({ ...form, modelId: value, providerChannelId: "" })
            }
            options={models.map((model) => ({
              value: model.id,
              label: model.displayName,
            }))}
          />
        </AdminField>
        <AdminField label="渠道（可选）">
          <Select
            aria-label="渠道"
            value={form.providerChannelId || "all"}
            onValueChange={(value) =>
              setForm({
                ...form,
                providerChannelId: value === "all" ? "" : value,
              })
            }
            options={[
              { value: "all", label: "全部渠道" },
              ...providerChannels.map((channel) => ({
                value: channel.id,
                label: `${channel.displayName} (${channel.availableAccountCount}/${channel.accountCount})`,
              })),
            ]}
          />
        </AdminField>
        <AdminField label="image2 模式（可选）">
          <Select
            aria-label="image2 模式"
            value={form.image2Mode || "all"}
            onValueChange={(value) =>
              setForm({
                ...form,
                image2Mode: value === "all" ? "" : value,
              })
            }
            options={[
              { value: "all", label: "不限" },
              { value: "standard", label: "standard" },
              { value: "high", label: "high" },
            ]}
          />
        </AdminField>
        <AdminField label="分辨率（可选）">
          <Input
            placeholder="如 1K / 2K / 4K"
            value={form.resolution}
            onChange={(event) =>
              setForm({ ...form, resolution: event.target.value })
            }
          />
        </AdminField>
        <AdminField label="点数">
          <Input
            type="number"
            min={0}
            value={form.credits}
            onChange={(event) =>
              setForm({ ...form, credits: Number(event.target.value) })
            }
          />
        </AdminField>
        <AdminField label="优先级">
          <Input
            type="number"
            min={0}
            value={form.priority}
            onChange={(event) =>
              setForm({ ...form, priority: Number(event.target.value) })
            }
          />
        </AdminField>
        <AdminField label="备注（可选）">
          <Input
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </AdminField>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          className="h-9 px-4 text-text-muted disabled:opacity-45"
          disabled={busy || !form.modelId}
          onClick={() => {
            setBusy(true);
            void onCreate({
              modelId: form.modelId,
              providerChannelId: form.providerChannelId.trim() || null,
              image2Mode: (form.image2Mode as "standard" | "high" | "") || null,
              resolution: form.resolution.trim() || null,
              credits: form.credits,
              priority: form.priority,
              note: form.note.trim() || null,
            }).finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          创建规则
        </Button>
        <Button
          type="button"
          className="h-9 px-4 text-text-muted"
          onClick={onCancel}
        >
          取消
        </Button>
      </div>
    </div>
  );
}
