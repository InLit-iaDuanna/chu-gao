"use client";

import type { ModelInfo } from "@/components/studio/lib/types";
import type { LunaConfigUpdate, LunaStatus } from "@/lib/chat-model-options";

import type {
  AccountImportResult,
  AdminAnnouncement,
  AdminAnnouncementInput,
  AdminGenerationListResult,
  AdminIntegrations,
  AdminIntegrationsPatch,
  AdminInvite,
  AdminProvider,
  AdminProviderAccount,
  AdminProviderAccountInput,
  AdminProviderAccountPatch,
  AdminProviderInput,
  AdminProviderPatch,
  AdminRedemptionCode,
  AdminStats,
  AdminUserDetail,
  AdminUserPatch,
  AdminUserSummary,
  AuditEntry,
  ChannelRequestConfig,
  ConversationPricing,
  Health,
  PricingRule,
  PricingRuleInput,
  SystemConfigEntry,
} from "./types";

// ---------- 基础请求 ----------

export class AdminApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export function isAdminApiError(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError;
}

interface Envelope {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

export interface AdminChatRuntimeConfig {
  enabled: boolean;
  profiles: string[];
  userAllowlist: string[];
  queueTimeoutMs: number | null;
}

export interface AdminChatRuntime {
  config: AdminChatRuntimeConfig;
  protocolVersion: number;
  health: {
    online: boolean;
    instances: Array<{
      instanceId: string;
      hostname: string;
      pid: number;
      buildId: string;
      protocolVersions: number[];
      status: string;
      running: number;
    }>;
  };
  outstanding: {
    queued: number;
    running: number;
    reserved: number;
    activeConversations: number;
  };
  drained: boolean;
}

export const getAdminChatRuntime = () =>
  request<AdminChatRuntime>("/api/admin/chat-runtime");
export const patchAdminChatRuntime = (input: Partial<AdminChatRuntimeConfig>) =>
  patch<{ config: AdminChatRuntimeConfig; protocolVersion: number }>(
    "/api/admin/chat-runtime",
    input,
  );

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new AdminApiError("NETWORK_ERROR", "网络连接失败，请检查网络", 0);
  }

  const envelope = (await response.json().catch(() => null)) as Envelope | null;

  if (response.ok && envelope?.ok === true) {
    return envelope.data as T;
  }

  throw new AdminApiError(
    envelope?.error?.code ?? `HTTP_${response.status}`,
    envelope?.error?.message ?? "请求失败",
    response.status,
  );
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

const del = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "DELETE",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// ---------- 仪表盘 ----------

export const getAdminStats = () => request<AdminStats>("/api/admin/stats");

// ---------- 用户 ----------

export const listAdminUsers = (params?: { q?: string; status?: string }) => {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();
  return request<AdminUserSummary[]>(`/api/admin/users${qs ? `?${qs}` : ""}`);
};

export const getAdminUser = (id: string) =>
  request<AdminUserDetail>(`/api/admin/users/${id}`);

export const patchAdminUser = (id: string, input: AdminUserPatch) =>
  patch<AdminUserDetail>(`/api/admin/users/${id}`, input);

export const banAdminUser = (id: string) =>
  del<{ id: string; status: string }>(`/api/admin/users/${id}`);

export const adjustAdminUserCredits = async (
  id: string,
  input: { amount: number; note?: string; operationKey?: string },
) => {
  const storageKey = `admin-credit-pending:${id}`;
  const payload = JSON.stringify({
    amount: input.amount,
    note: input.note ?? "",
  });
  let saved: { operationKey: string; payload: string } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
  } catch {}
  if (
    saved &&
    (saved.payload !== payload ||
      (input.operationKey && input.operationKey !== saved.operationKey))
  )
    throw new AdminApiError(
      "PENDING_ADJUSTMENT",
      "上一笔调额结果尚未确认，请先用原金额和备注重试确认",
      409,
    );
  const operationKey =
    input.operationKey ?? saved?.operationKey ?? crypto.randomUUID();
  // No request is sent when its identity cannot be retained across a reload.
  try {
    if (typeof sessionStorage === "undefined")
      throw new Error("No session storage");
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ operationKey, payload }),
    );
  } catch {
    throw new AdminApiError(
      "OPERATION_ID_UNAVAILABLE",
      "浏览器无法保存调额请求标识，请允许会话存储后重试",
      0,
    );
  }
  try {
    const result = await post<{ id: string; email: string; credits: number }>(
      `/api/admin/users/${id}/credits`,
      { ...input, operationKey },
    );
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    return result;
  } catch (error) {
    if (
      isAdminApiError(error) &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 409, 429].includes(error.status)
    )
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
    throw error;
  }
};

export const resetAdminUserPassword = (id: string, password: string) =>
  post<{ id: string }>(`/api/admin/users/${id}/password`, { password });

export const revokeAdminUserSessions = (id: string, reason?: string) =>
  post<{ id: string; sessionVersion: number }>(
    `/api/admin/users/${id}/sessions/revoke`,
    { reason },
  );

export const archiveAdminUserConversations = (
  id: string,
  mode: "all" | "inactive",
) =>
  post<{ archived: number }>(`/api/admin/users/${id}/conversations/archive`, {
    mode,
  });

export const deleteAdminUserGenerations = (
  id: string,
  input: { mode: "all" | "failed" | "beforeDate"; beforeDate?: string },
) =>
  post<{ deleted: number }>(`/api/admin/users/${id}/generations/delete`, input);

// ---------- 生成记录 ----------

export interface AdminGenerationQuery {
  status?: string[];
  userId?: string;
  q?: string;
  modelId?: string;
  providerId?: string;
  providerAccountId?: string;
  errorCode?: string;
  active?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}

export const listAdminGenerations = (query: AdminGenerationQuery = {}) => {
  const search = new URLSearchParams();
  for (const status of query.status ?? []) search.append("status", status);
  if (query.userId) search.set("userId", query.userId);
  if (query.q) search.set("q", query.q);
  if (query.modelId) search.set("modelId", query.modelId);
  if (query.providerId) search.set("providerId", query.providerId);
  if (query.providerAccountId)
    search.set("providerAccountId", query.providerAccountId);
  if (query.errorCode) search.set("errorCode", query.errorCode);
  if (query.active) search.set("active", "true");
  if (query.from) search.set("from", query.from);
  if (query.to) search.set("to", query.to);
  if (query.limit) search.set("limit", String(query.limit));
  const qs = search.toString();
  return request<AdminGenerationListResult>(
    `/api/admin/generations${qs ? `?${qs}` : ""}`,
  );
};

export const clearRecentAdminGenerations = (limit = 20) =>
  post<{ cleared: number }>("/api/admin/generations/clear-recent", { limit });

// ---------- 渠道 ----------

export const listAdminProviders = () =>
  request<AdminProvider[]>("/api/admin/providers");

export const createAdminProvider = (input: AdminProviderInput) =>
  post<AdminProvider>("/api/admin/providers", input);

export const patchAdminProvider = (id: string, input: AdminProviderPatch) =>
  patch<AdminProvider>(`/api/admin/providers/${id}`, input);

export const disableAdminProvider = (id: string) =>
  del<{ id: string; disabledAccounts: number }>(`/api/admin/providers/${id}`);

export const restoreAdminProvider = (id: string) =>
  post<AdminProvider>(`/api/admin/providers/${id}/restore`);

export const testAdminProvider = (id: string) =>
  post<{ health: Health; modelId: string; imageCount: number }>(
    `/api/admin/providers/${id}/test`,
  );

export const listAdminProviderAccounts = (providerId: string) =>
  request<AdminProviderAccount[]>(
    `/api/admin/providers/${providerId}/accounts`,
  );

export const createAdminProviderAccount = (
  providerId: string,
  input: AdminProviderAccountInput,
) =>
  post<AdminProviderAccount>(
    `/api/admin/providers/${providerId}/accounts`,
    input,
  );

export const patchAdminProviderAccount = (
  providerId: string,
  accountId: string,
  input: AdminProviderAccountPatch,
) =>
  patch<AdminProviderAccount>(
    `/api/admin/providers/${providerId}/accounts/${accountId}`,
    input,
  );

export const disableAdminProviderAccount = (
  providerId: string,
  accountId: string,
) =>
  del<{ id: string }>(
    `/api/admin/providers/${providerId}/accounts/${accountId}`,
  );

export const restoreAdminProviderAccount = (
  providerId: string,
  accountId: string,
) =>
  post<AdminProviderAccount>(
    `/api/admin/providers/${providerId}/accounts/${accountId}/restore`,
  );

export const testAdminProviderAccount = (
  providerId: string,
  accountId: string,
) =>
  post<{ ok: boolean; accountId: string; health: string }>(
    `/api/admin/providers/${providerId}/accounts/${accountId}/test`,
  );

export const importAdminProviderAccounts = (
  providerId: string,
  input: {
    mode: "csv" | "lines";
    text?: string;
    csvText?: string;
    defaultMaxConcurrency?: number;
    defaultWeight?: number;
  },
) =>
  post<AccountImportResult>(
    `/api/admin/providers/${providerId}/accounts/import`,
    input,
  );

export const patchAdminProviderChannel = (
  providerId: string,
  input: { baseUrl: string; displayName?: string; maxConcurrency?: number },
) =>
  patch<{ baseUrl: string; updatedAccounts: number }>(
    `/api/admin/providers/${providerId}/channels`,
    input,
  );

export const disableAdminProviderChannel = (
  providerId: string,
  baseUrl: string,
) =>
  del<{ baseUrl: string; disabled: number }>(
    `/api/admin/providers/${providerId}/channels`,
    { baseUrl },
  );

export const getAdminChannelRequestConfigs = () =>
  request<{ configs: Record<string, ChannelRequestConfig> }>(
    "/api/admin/providers/channel-request-config",
  );

export const patchAdminChannelRequestConfig = (input: {
  baseUrl: string;
  sizes?: string[];
  responseFormat?: string;
  bodyTemplate?: string | null;
}) =>
  patch<{ configs: Record<string, ChannelRequestConfig> }>(
    "/api/admin/providers/channel-request-config",
    input,
  );

// ---------- 定价 ----------

export const getAdminPricing = () =>
  request<{ models: ModelInfo[]; rules: PricingRule[] }>("/api/admin/pricing");

export const createAdminPricingRule = (input: PricingRuleInput) =>
  post<PricingRule>("/api/admin/pricing", input);

export const patchAdminPricingRule = (
  id: string,
  input: Partial<PricingRuleInput>,
) => patch<PricingRule>("/api/admin/pricing", { id, ...input });

// 对话定价读取走对话聊天端点（GET 返回定价），修改走管理端点。
export const getAdminConversationPricing = () =>
  request<ConversationPricing>("/api/conversations/chat");

export const patchAdminConversationPricing = (input: ConversationPricing) =>
  patch<ConversationPricing>("/api/admin/conversation-pricing", input);

// ---------- 邀请码 / 兑换码 ----------

export const listAdminInvites = (status?: "active" | "revoked" | "expired") =>
  request<AdminInvite[]>(
    `/api/admin/invites${status ? `?status=${status}` : ""}`,
  );

export const createAdminInvites = (input: {
  count: number;
  maxUses?: number;
  initialCredits?: number;
  note?: string;
  expiresAt?: string;
}) => post<AdminInvite[]>("/api/admin/invites", input);

export const revokeAdminInvite = (id: string) =>
  del<AdminInvite>(`/api/admin/invites/${id}`);

export const listAdminRedemptionCodes = () =>
  request<AdminRedemptionCode[]>("/api/admin/redemption-codes");

export const createAdminRedemptionCodes = (input: {
  count: number;
  credits: number;
  maxUses?: number;
  note?: string;
  expiresAt?: string;
}) => post<AdminRedemptionCode[]>("/api/admin/redemption-codes", input);

export const revokeAdminRedemptionCode = (id: string) =>
  del<AdminRedemptionCode>(`/api/admin/redemption-codes/${id}`);

// ---------- 审计 ----------

export const listAdminAudit = () => request<AuditEntry[]>("/api/admin/audit");

// ---------- AI 集成 ----------

export const getAdminIntegrations = () =>
  request<AdminIntegrations>("/api/admin/integrations");

export const patchAdminIntegrations = (input: AdminIntegrationsPatch) =>
  patch<AdminIntegrations>("/api/admin/integrations", input);

export const getAdminLuna = () =>
  request<LunaStatus>("/api/admin/integrations/luna");

export const patchAdminLuna = (input: LunaConfigUpdate) =>
  patch<LunaStatus>("/api/admin/integrations/luna", input);

export const getAdminSol = () =>
  request<LunaStatus>("/api/admin/integrations/sol");
export const patchAdminSol = (input: LunaConfigUpdate) =>
  patch<LunaStatus>("/api/admin/integrations/sol", input);

export const testAdminDeepseek = () =>
  post<{ ok: boolean; model: string }>("/api/admin/integrations/test");

// ---------- 系统配置 ----------

export const getAdminSystemConfig = () =>
  request<SystemConfigEntry[]>("/api/admin/system-config");

export const patchAdminSystemConfig = (key: string, value: unknown) =>
  patch<{ key: string; value: unknown }>("/api/admin/system-config", {
    key,
    value,
  });

// ---------- 公告 ----------

export const listAdminAnnouncements = () =>
  request<AdminAnnouncement[]>("/api/admin/announcements");

export const createAdminAnnouncement = (input: AdminAnnouncementInput) =>
  post<AdminAnnouncement>("/api/admin/announcements", input);

export const patchAdminAnnouncement = (
  id: string,
  input: Partial<AdminAnnouncementInput>,
) => patch<AdminAnnouncement>(`/api/admin/announcements/${id}`, input);

export const deleteAdminAnnouncement = (id: string) =>
  del<{ id: string }>(`/api/admin/announcements/${id}`);

// ---------- API Key 配置 ----------

export type ApiPriceTier = "1K" | "2K" | "4K";
export type ApiPriceTable = Record<string, Partial<Record<ApiPriceTier, number>>>;

export interface ApiKeyAdminConfig {
  creditMultiplier: number;
  rateLimitPerMin: number;
  prices: ApiPriceTable;
  docsMarkdown: string;
  docsIsDefault: boolean;
  models: {
    id: string;
    displayName: string;
    resolutions: ApiPriceTier[];
    webPrices: Partial<Record<ApiPriceTier, number>>;
  }[];
}

export type ApiKeyAdminPatch = Partial<
  Pick<
    ApiKeyAdminConfig,
    "creditMultiplier" | "rateLimitPerMin" | "prices" | "docsMarkdown"
  >
>;

export const getAdminApiKeyConfig = () =>
  request<ApiKeyAdminConfig>("/api/admin/api-key-config");

export const patchAdminApiKeyConfig = (input: ApiKeyAdminPatch) =>
  patch<ApiKeyAdminConfig>("/api/admin/api-key-config", input);
