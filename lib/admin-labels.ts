export type HealthValue = "HEALTHY" | "DEGRADED" | "DOWN";
export type RoleValue = "USER" | "ADMIN";
export type UserStatusValue = "ACTIVE" | "BANNED";

export const HEALTH_LABELS: Record<HealthValue, string> = {
  HEALTHY: "健康",
  DEGRADED: "降级",
  DOWN: "不可用",
};

export const ROLE_LABELS: Record<RoleValue, string> = {
  USER: "普通用户",
  ADMIN: "管理员",
};

export const USER_STATUS_LABELS: Record<UserStatusValue, string> = {
  ACTIVE: "正常",
  BANNED: "已封禁",
};

export const PROVIDER_PROTOCOL_LABELS: Record<string, string> = {
  OPENAI_IMAGES: "Image2 图像生成",
  GEMINI_IMAGE: "Nano Banana 图像生成",
  OPENAI_RESPONSES_IMAGE: "Responses 图像生成",
};

export function healthLabel(value: string) {
  return HEALTH_LABELS[value as HealthValue] ?? value;
}

export function providerProtocolLabel(value: string) {
  return PROVIDER_PROTOCOL_LABELS[value] ?? value;
}
