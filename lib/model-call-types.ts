export type CallSource = "web" | "api" | "agent" | "system";

export function generationCallSource(input: {
  apiKeyId?: string | null;
  agentAuthorizationId?: string | null;
}): CallSource {
  return input.agentAuthorizationId ? "agent" : input.apiKeyId ? "api" : "web";
}

export const CALL_SOURCE_LABELS: Record<string, string> = {
  web: "网站",
  api: "API",
  agent: "Agent",
  system: "系统",
};
export const CALL_OPERATION_LABELS: Record<string, string> = {
  "image.generate": "生图请求",
  "image.persist": "图片下载 / 保存",
  "image.prepare": "参考图准备",
  "image.route": "渠道选择",
  "chat.reply": "对话回复",
  "chat.summary": "上下文压缩",
  "prompt.compile": "提示词编译",
  "prompt.optimize": "提示词优化",
  "ppt.optimize": "PPT 提示词优化",
  "creative.plan": "创作方案",
  "creative.inspect": "参考图分析",
  "creative.check": "图片检查",
  "integration.test": "连通性测试",
};
export const CALL_ERROR_LABELS: Record<string, string> = {
  CONTENT_REJECTED: "内容安全拒绝",
  BAD_REQUEST: "请求参数错误",
  RATE_LIMITED: "上游限流",
  TRANSIENT_PROVIDER: "上游服务异常",
  AUTH_ACCOUNT_FATAL: "账号 / 鉴权异常",
  TIMEOUT: "请求超时",
  NETWORK: "网络连接异常",
  INVALID_RESPONSE: "返回格式异常",
  STORAGE: "图片下载 / 存储异常",
  CAPACITY: "渠道繁忙",
  CANCELED: "调用取消",
  UNKNOWN: "其他异常",
};

export function formatCallTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export interface AdminModelCall {
  id: string;
  kind: string;
  source: string;
  operation: string;
  status: string;
  modelId: string;
  userId: string | null;
  generationId: string | null;
  imageId: string | null;
  conversationId: string | null;
  chatAttemptId: string | null;
  providerId: string | null;
  providerAccountId: string | null;
  providerName: string | null;
  endpoint: string | null;
  requestId: string | null;
  httpStatus: number | null;
  errorCategory: string | null;
  errorMessage: string | null;
  requestContent?: string | null;
  responseContent?: string | null;
  inputTokens: number | null;
  uncachedInputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  outputTokens: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  userEmail?: string | null;
  userName?: string | null;
}
