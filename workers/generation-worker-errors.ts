import {
  classifyProviderFailure,
  serializeProviderError,
} from "@/lib/providers/diagnostics";
import { ProviderSubmissionUnknownError } from "@/lib/providers/single-submit";

export function userFacingGenerationError(error: unknown): string {
  if (error instanceof Error && error.name === "ProviderCreditsError")
    return "积分不足，无法使用备用价格；本次未生成，已退还预扣积分";
  if (error instanceof ProviderSubmissionUnknownError) return error.message;
  const { category } = classifyProviderFailure(error);

  if (category === "CONTENT_REJECTED") {
    return "[MODERATION_REJECTED] 提示词或参考图包含不允许的内容，请调整后再试。";
  }

  if (category === "BAD_REQUEST") {
    return "生成请求被渠道拒绝，请调整提示词、参考图或参数后再试。";
  }

  const message = serializeProviderError(error);

  if (message.includes("provider returned no images")) {
    return "渠道没有返回图片，请稍后重试或更换模型。";
  }

  if (
    message.includes("invalid reference image key") ||
    message.includes("ENOENT")
  ) {
    return "参考图不可用，请重新上传后再试。";
  }

  return "渠道生成失败，请稍后重试或联系管理员检查渠道状态。";
}

export function generationFailureCode(error: unknown): string {
  if (error instanceof Error && error.name === "ProviderCreditsError")
    return "INSUFFICIENT_CREDITS";
  if (error instanceof ProviderSubmissionUnknownError)
    return "UPSTREAM_RESULT_UNKNOWN";
  const { category } = classifyProviderFailure(error);

  if (category === "CONTENT_REJECTED") {
    return "MODERATION_REJECTED";
  }

  if (category === "BAD_REQUEST") {
    return "PROVIDER_REJECTED_REQUEST";
  }

  return "PROVIDER_ERROR";
}

export function usageFailureCategory(error: unknown): string {
  if (error instanceof Error && error.name === "ProviderCreditsError")
    return "billing";
  const { category } = classifyProviderFailure(error);

  if (category === "CONTENT_REJECTED") {
    return "moderation";
  }

  if (category === "BAD_REQUEST") {
    return "request";
  }

  return "provider";
}
