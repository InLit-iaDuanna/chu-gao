import { parseToolArguments } from "@/lib/chat-agent-tools";
import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import {
  getModelWithPricing,
  listModelsWithPricing,
} from "@/lib/model-pricing";
import type { ModelDefinition } from "@/lib/models/types";
import {
  generationRequestSchema,
  validateAgainstModelDefinition,
} from "@/lib/models/validate";

/**
 * check_credits: a read-only quote. It never debits or reserves anything; the
 * image submission still prices and reserves on its own.
 */

export const CHECK_CREDITS_MODEL_LIST_LIMIT = 8;
const DEFAULT_IMAGE_MODEL_ID = "gpt-image-2";

export interface CheckCreditsContext {
  userId: string;
  imageModelId?: string;
  imageSize?: string;
  imageQuality?: string;
  imageOutputFormat?: string;
  imageN?: number;
}

export interface CheckCreditsOutcome {
  ok: boolean;
  output: string;
}

interface Quote {
  perImage: number;
  total: number;
  size: string;
  quality: string;
  n: number;
}

function quote(
  model: ModelDefinition,
  settings: {
    size?: string;
    quality?: string;
    outputFormat?: string;
    n?: number;
  },
): Quote | null {
  try {
    const input = generationRequestSchema.parse({
      modelId: model.id,
      prompt: "quote",
      size: settings.size,
      quality: settings.quality,
      outputFormat: settings.outputFormat,
      n: settings.n ?? 1,
    });
    const request = validateAgainstModelDefinition(input, model);
    return {
      perImage: estimateCost(model, { ...request, n: 1 }),
      total: estimateCost(model, request),
      size: request.size,
      quality: request.quality ?? "auto",
      n: request.n,
    };
  } catch {
    return null;
  }
}

export function formatCredits(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.?0+$/, "");
}

function modelName(model: ModelDefinition) {
  return `${model.displayName}（${model.id}）`;
}

/** Run one check_credits call. Never throws. */
export async function runCheckCreditsTool(
  rawArguments: string,
  context: CheckCreditsContext,
): Promise<CheckCreditsOutcome> {
  try {
    const args = parseToolArguments(rawArguments);
    const requestedModelId =
      typeof args.modelId === "string" && args.modelId.trim()
        ? args.modelId.trim().slice(0, 128)
        : null;
    const user = await db.user.findUnique({
      where: { id: context.userId },
      select: { credits: true },
    });
    if (!user)
      return {
        ok: false,
        output:
          "[积分查询] 没有查到账户信息。告诉用户暂时查不到余额，请刷新页面后在界面上查看。",
      };
    const lines = [
      "[积分查询结果]",
      `当前余额：${formatCredits(user.credits)} 积分`,
    ];
    const currentId = context.imageModelId ?? DEFAULT_IMAGE_MODEL_ID;
    let target: ModelDefinition | null = null;
    if (requestedModelId) {
      target = await getModelWithPricing(requestedModelId);
      if (!target)
        lines.push(
          `没有找到 id 为 ${requestedModelId} 的图片模型，下面按用户当前的生图设置估算。`,
        );
    }
    const usingCurrent = !target;
    target ??= await getModelWithPricing(currentId);
    if (target) {
      const settings = {
        size: context.imageSize,
        quality: context.imageQuality,
        outputFormat: context.imageOutputFormat,
        n: context.imageN,
      };
      const exact = quote(target, settings);
      const fallback = exact ? null : quote(target, { n: 1 });
      const priced = exact ?? fallback;
      if (priced) {
        lines.push(
          `${usingCurrent ? "按用户当前的生图设置" : "按指定模型和用户当前的尺寸、质量设置"}：${modelName(target)}，尺寸 ${priced.size}，质量 ${priced.quality}，${priced.n} 张 → 预计 ${formatCredits(priced.total)} 积分（单张约 ${formatCredits(priced.perImage)} 积分）${fallback ? "。当前设置与这个模型不兼容，以上按该模型的默认设置估算" : ""}`,
          user.credits >= priced.total
            ? "余额足够按这个设置生成一次。"
            : `余额不足以按这个设置生成一次（还差约 ${formatCredits(priced.total - user.credits)} 积分）。`,
        );
      } else
        lines.push(`${modelName(target)} 暂时无法估算价格。`);
    } else lines.push(`当前生图模型 ${currentId} 不可用，无法估算价格。`);
    const models = (await listModelsWithPricing()).slice(
      0,
      CHECK_CREDITS_MODEL_LIST_LIMIT,
    );
    const prices = models.flatMap((model) => {
      const priced = quote(model, { n: 1 });
      return priced
        ? [
            `- ${modelName(model)}：${formatCredits(priced.perImage)} 积分/张（默认尺寸 ${priced.size}）`,
          ]
        : [];
    });
    if (prices.length)
      lines.push("可选图片模型的默认单价（按各自默认设置，每张）：", ...prices);
    lines.push(
      "以上是按当前价目的估算：参考图、尺寸、质量和张数都会影响价格，实际扣费以提交时界面显示为准。告诉用户余额和价格时以这里的数字为准，不要编造或换算出其他价格。",
    );
    return { ok: true, output: lines.join("\n") };
  } catch {
    return {
      ok: false,
      output:
        "[积分查询] 查询失败，没有拿到余额和价格。如实告诉用户暂时查不到，请在界面上查看余额；不要凭记忆报数字。",
    };
  }
}
