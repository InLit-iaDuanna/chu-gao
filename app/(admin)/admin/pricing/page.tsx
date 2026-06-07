import {
  Image2PricingMatrix,
  PricingRuleForm,
} from "@/components/admin/AdminForms";
import { DataTable } from "@/components/admin/DataTable";
import { resolvePerImageCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listModelsWithPricing } from "@/lib/model-pricing";
import type {
  Image2Mode,
  ModelDefinition,
  Resolution,
} from "@/lib/models/types";

export const dynamic = "force-dynamic";

function effectivePriceForResolution(
  model: ModelDefinition,
  resolution: Resolution,
  image2Mode = model.defaults.image2Mode,
): number {
  return resolvePerImageCredits(model, {
    n: 1,
    resolution,
    aspectRatio: model.defaults.aspectRatio,
    outputFormat: model.defaults.outputFormat,
    background: model.defaults.background,
    image2Mode,
  }).credits;
}

function image2ModeLabel(mode: string | null | undefined): string {
  if (mode === "standard") {
    return "标准版";
  }

  if (mode === "high") {
    return "高推理";
  }

  return "全部";
}

function getImage2MatrixPrices(model: ModelDefinition | undefined) {
  const fallback = {
    standard: { "1K": 0, "2K": 0, "4K": 0 },
    high: { "1K": 0, "2K": 0, "4K": 0 },
  };

  if (!model) {
    return fallback;
  }

  const modes: Image2Mode[] = ["standard", "high"];
  const resolutions: Resolution[] = ["1K", "2K", "4K"];

  return Object.fromEntries(
    modes.map((mode) => [
      mode,
      Object.fromEntries(
        resolutions.map((resolution) => [
          resolution,
          effectivePriceForResolution(model, resolution, mode),
        ]),
      ),
    ]),
  ) as typeof fallback;
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
  const [models, rules] = await Promise.all([
    listModelsWithPricing(),
    getRules(),
  ]);
  const image2Model = models.find((model) => model.id === "gpt-image-2");

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">定价</p>
        <h1 className="mt-2 text-3xl font-semibold">模型参数定价</h1>
      </div>
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
                "模式",
                "分辨率",
                "比例",
                "格式",
                "背景",
                "参考图",
                "点数",
                "状态",
              ]}
              rows={rules.map((rule) => [
                rule.modelId,
                image2ModeLabel(rule.image2Mode),
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
