type ApiErrorLike = {
  code?: string;
  message?: string;
};

const SERVICE_UNAVAILABLE_CODES = new Set([
  "AUTH_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
  "QUEUE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export function friendlyErrorMessage(
  error: ApiErrorLike | string | null | undefined,
  fallback: string,
): string {
  const code = typeof error === "string" ? undefined : error?.code;
  const message = typeof error === "string" ? error : error?.message;

  if (code === "UNAUTHORIZED") {
    return "登录状态已失效，请重新登录。";
  }

  if (code === "INSUFFICIENT_CREDITS") {
    return "余额不足。请降低张数或分辨率，或联系管理员充值。";
  }

  if (code === "MODEL_NOT_AVAILABLE") {
    return "当前没有可用模型。请稍后重试，或联系管理员启用模型。";
  }

  if (
    code === "RATE_LIMITED" ||
    code === "CONCURRENT_LIMIT" ||
    code === "MODERATION_RATE_LIMITED"
  ) {
    return message || "当前提交太频繁，请稍后再试。";
  }

  if (
    code === "MODERATION_REJECTED" ||
    code === "VALIDATION_ERROR" ||
    code === "UNSUPPORTED_PARAM" ||
    code === "PROVIDER_REJECTED_REQUEST"
  ) {
    return message || fallback;
  }

  if (code && SERVICE_UNAVAILABLE_CODES.has(code)) {
    return "服务暂时不可用。请稍后重试；如果持续失败，请联系管理员检查服务状态。";
  }

  if (!message) {
    return fallback;
  }

  if (
    /DATABASE_URL|Redis|ECONNREFUSED|Prisma|database|redis|docker compose|dev:doctor/i.test(
      message,
    )
  ) {
    return "服务暂时不可用。请稍后重试；如果持续失败，请联系管理员检查服务状态。";
  }

  return message;
}
