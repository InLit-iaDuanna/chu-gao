"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { patchJson, postJson } from "@/components/admin/admin-form-utils";

type Image2ModeValue = "standard" | "high";
type Image2PriceTier = "auto" | "1K" | "2K" | "4K";

const IMAGE2_TIER_LABELS: Record<Image2PriceTier, string> = {
  auto: "自动",
  "1K": "1K 档（1024 系）",
  "2K": "2K 档（2048 系）",
  "4K": "4K 档（3840/2160 系）",
};

const IMAGE2_MODES: Image2ModeValue[] = ["standard", "high"];
const IMAGE2_PRICE_TIERS: Image2PriceTier[] = ["auto", "1K", "2K", "4K"];

export function ConversationPricingForm({
  initialPricing,
}: {
  initialPricing: { standardCredits: number; reasoningCredits: number };
}) {
  const router = useRouter();
  const [pricing, setPricing] = useState(initialPricing);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !Number.isInteger(pricing.standardCredits * 2) ||
      pricing.standardCredits < 0 ||
      !Number.isInteger(pricing.reasoningCredits * 2) ||
      pricing.reasoningCredits < 0
    ) {
      setMessage("请输入 0.5 的整数倍点数");
      return;
    }

    setIsSaving(true);
    setMessage("保存中...");
    try {
      await patchJson("/api/admin/conversation-pricing", pricing);
      setMessage("对话定价已保存");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="surface-panel overflow-hidden">
      <div className="border-b border-border px-4 py-4">
        <p className="text-sm font-medium">AI 对话价格</p>
        <p className="mt-1 text-sm text-text-muted">
          每发送一次消息扣除对应点数；上游在返回内容前失败会自动退款。
        </p>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {(
          [
            ["standardCredits", "普通对话", "关闭思考模式时"],
            ["reasoningCredits", "思考对话", "开启思考模式时"],
          ] as const
        ).map(([key, label, description]) => (
          <label key={key} className="block">
            <span className="text-sm font-medium">{label}</span>
            <span className="mt-1 block text-xs text-text-muted">
              {description}
            </span>
            <div className="mt-2 flex items-center gap-2">
              <input
                className="h-10 w-28 rounded-[6px] border border-border bg-surface px-3 text-sm"
                type="number"
                min={0}
                step={0.5}
                value={pricing[key]}
                onChange={(event) =>
                  setPricing((current) => ({
                    ...current,
                    [key]: Number(event.target.value),
                  }))
                }
              />
              <span className="text-sm text-text-muted">点 / 次</span>
            </div>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-border px-4 py-3">
        <button className="tool-button h-10" type="submit" disabled={isSaving}>
          {isSaving ? "保存中..." : "保存对话定价"}
        </button>
        {message ? (
          <span className="text-sm text-text-muted">{message}</span>
        ) : null}
      </div>
    </form>
  );
}

export function PricingRuleForm({ models }: { models: Array<{ id: string }> }) {
  const router = useRouter();
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [resolution, setResolution] = useState("1K");
  const [credits, setCredits] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit =
    models.length > 0 &&
    modelId.trim().length > 0 &&
    Number.isFinite(credits) &&
    !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("保存中...");

    try {
      await postJson("/api/admin/pricing", {
        modelId,
        resolution: resolution || null,
        credits,
        priority: 10,
      });
      setMessage("定价已保存");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">新增定价规则</p>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_120px_auto]">
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))}
        </select>
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
        >
          <option value="">全部档位</option>
          <option value="1K">1K 档</option>
          <option value="2K">2K 档</option>
          <option value="4K">4K 档</option>
        </select>
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0}
          value={credits}
          onChange={(event) => setCredits(Number(event.target.value))}
        />
        <button
          className="tool-button h-10"
          type="submit"
          disabled={!canSubmit}
        >
          保存
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </form>
  );
}

export function Image2PricingMatrix({
  initialPrices,
}: {
  initialPrices: Record<Image2ModeValue, Record<Image2PriceTier, number>>;
}) {
  const router = useRouter();
  const [prices, setPrices] = useState(initialPrices);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [messageByKey, setMessageByKey] = useState<Record<string, string>>({});

  function updatePrice(
    mode: Image2ModeValue,
    tier: Image2PriceTier,
    value: number,
  ) {
    setPrices((current) => ({
      ...current,
      [mode]: { ...current[mode], [tier]: value },
    }));
  }

  async function savePrice(mode: Image2ModeValue, tier: Image2PriceTier) {
    const key = mode + ":" + tier;
    const credits = prices[mode][tier];

    if (!Number.isFinite(credits) || credits < 0) {
      setMessageByKey((current) => ({ ...current, [key]: "请输入有效点数" }));
      return;
    }

    setSavingKey(key);
    setMessageByKey((current) => ({ ...current, [key]: "保存中..." }));

    try {
      await postJson("/api/admin/pricing", {
        modelId: "gpt-image-2",
        image2Mode: mode,
        resolution: tier,
        credits,
        priority: 100,
        isActive: true,
      });
      setMessageByKey((current) => ({ ...current, [key]: "已保存" }));
      router.refresh();
    } catch (error) {
      setMessageByKey((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "保存失败",
      }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section className="surface-panel overflow-hidden">
      <div className="border-b border-border px-4 py-4">
        <p className="text-sm font-medium">Image2 价格表</p>
        <p className="mt-1 text-sm text-text-muted">
          每个格子是一次成功生图的售价。对话模式确认生图时，会在对话费之外叠加这里的价格。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="bg-surface-2 text-text-muted">
            <tr>
              <th className="w-32 px-4 py-3 font-medium">版本</th>
              {IMAGE2_PRICE_TIERS.map((tier) => (
                <th key={tier} className="px-4 py-3 font-medium">
                  {IMAGE2_TIER_LABELS[tier]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IMAGE2_MODES.map((mode) => (
              <tr key={mode} className="border-t border-border">
                <th className="px-4 py-4 text-left font-medium">
                  {mode === "high" ? "高推理" : "标准版"}
                </th>
                {IMAGE2_PRICE_TIERS.map((tier) => {
                  const key = mode + ":" + tier;
                  const isSaving = savingKey === key;

                  return (
                    <td key={tier} className="px-4 py-4 align-top">
                      <div className="flex items-center gap-2">
                        <input
                          aria-label={
                            (mode === "high" ? "高推理 " : "标准版 ") +
                            IMAGE2_TIER_LABELS[tier] +
                            "价格"
                          }
                          className="h-10 w-20 rounded-[6px] border border-border bg-surface px-3 text-sm"
                          type="number"
                          min={0}
                          step={1}
                          value={prices[mode][tier]}
                          onChange={(event) =>
                            updatePrice(mode, tier, Number(event.target.value))
                          }
                        />
                        <button
                          className="tool-button h-10 px-3"
                          type="button"
                          disabled={isSaving}
                          onClick={() => void savePrice(mode, tier)}
                        >
                          保存
                        </button>
                      </div>
                      {messageByKey[key] ? (
                        <p className="mt-2 text-xs text-text-muted">
                          {messageByKey[key]}
                        </p>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
