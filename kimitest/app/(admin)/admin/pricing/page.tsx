import {
  ConversationPricingForm,
  Image2PricingMatrix,
  PricingRuleForm,
} from "@/components/admin/PricingAdminForms";
import { getConversationPricing } from "@/lib/ai-config";
import { DataTable } from "@/components/admin/DataTable";
import { resolvePerImageCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listModelsWithPricing } from "@/lib/model-pricing";
import { aspectRatioForSize } from "@/lib/models/options";
import type {
  Image2Mode,
  ImageSize,
  ModelDefinition,
  Resolution,
} from "@/lib/models/types";

export const dynamic = "force-dynamic";

type Image2PriceTier = "auto" | Resolution;

const IMAGE2_MODES: Image2Mode[] = ["standard", "high"];
const IMAGE2_PRICE_TIERS: Image2PriceTier[] = ["auto", "1K", "2K", "4K"];

function sizeForTier(tier: Image2PriceTier): ImageSize {
  if (tier === "auto") return "auto";
  if (tier === "2K") return "2048x2048";
  if (tier === "4K") return "3840x2160";
  return "1024x1024";
}

function effectiveImage2Price(
  model: ModelDefinition,
  mode: Image2Mode,
  tier: Image2PriceTier,
): number {
  const size = sizeForTier(tier);
  const resolution: Resolution = tier === "auto" ? "1K" : tier;

  return resolvePerImageCredits(model, {
    n: 1,
    size,
    image2Mode: mode,
    resolution,
    aspectRatio: aspectRatioForSize(size),
    outputFormat: model.defaults.outputFormat,
    background: model.defaults.background,
  }).credits;
}

function getImage2MatrixPrices(model: ModelDefinition | undefined) {
  const fallback: Record<Image2Mode, Record<Image2PriceTier, number>> = {
    standard: { auto: 8, "1K": 7, "2K": 9, "4K": 15 },
    high: { auto: 8, "1K": 11, "2K": 15, "4K": 20 },
  };

  if (!model) {
    return fallback;
  }

  return Object.fromEntries(
    IMAGE2_MODES.map((mode) => [
      mode,
      Object.fromEntries(
        IMAGE2_PRICE_TIERS.map((tier) => [
          tier,
          effectiveImage2Price(model, mode, tier),
        ]),
      ),
    ]),
  ) as Record<Image2Mode, Record<Image2PriceTier, number>>;
}

async function getRules() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  try {
    return await db.modelPricing.findMany({
      orderBy: [
        { modelId: "asc" },
        { priority: "desc" },
        { updatedAt: "desc" },
      ],
    });
  } catch (error) {
    logger.error({ error }, "Admin pricing rules read failed.");
    return null;
  }
}

export default async function AdminPricingPage() {
  const [models, rules, conversationPricing] = await Promise.all([
    listModelsWithPricing(),
    getRules(),
    getConversationPricing(),
  ]);
  const image2Model = models.find((model) => model.id === "gpt-image-2");

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">定价</p>
        <h1 className="mt-2 text-3xl font-semibold">模型参数定价</h1>
      </div>
      <ConversationPricingForm initialPricing={conversationPricing} />
      <Image2PricingMatrix initialPrices={getImage2MatrixPrices(image2Model)} />
      <details className="surface-panel p-4">
        <summary className="cursor-pointer text-sm font-medium">
          高级定价规则
        </summary>
        <div className="mt-4">
          <PricingRuleForm models={models} />
        </div>
      </details>
      {rules ? (
        <details className="surface-panel p-4">
          <summary className="cursor-pointer text-sm font-medium">
            规则明细
          </summary>
          <div className="mt-4">
            <DataTable
              headers={[
                "模型",
                "版本",
                "档位",
                "比例",
                "格式",
                "背景",
                "参考图",
                "点数",
                "状态",
              ]}
              rows={rules.map((rule) => [
                rule.modelId,
                rule.image2Mode === "high"
                  ? "高推理"
                  : rule.image2Mode === "standard"
                    ? "标准版"
                    : "通用",
                rule.resolution ?? "全部",
                rule.aspectRatio ?? "全部",
                rule.outputFormat ?? "全部",
                rule.background ?? "全部",
                rule.usesReference === null
                  ? "全部"
                  : rule.usesReference
                    ? "是"
                    : "否",
                `${rule.credits} 点`,
                rule.isActive ? "启用" : "停用",
              ])}
            />
          </div>
        </details>
      ) : (
        <div className="surface-panel p-6 text-sm text-text-muted">
          定价服务暂不可用，请确认数据库连接。
        </div>
      )}
    </div>
  );
}
