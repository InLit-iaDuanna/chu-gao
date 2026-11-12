// 浏览器端 API client：直接实现 app/api/* 的契约。
// 统一信封 { ok:true, data } | { ok:false, error:{ code, message, details? } }。

import type {
  ChatMessageInput,
  CompiledConversationPrompt,
  Conversation,
  ConversationPricing,
  ConversationSummary,
  CreateGenerationInput,
  CreateGenerationResult,
  Generation,
  GenerationListPage,
  Me,
  ModelInfo,
  PptGeneration,
  CreatePptInput,
  UploadResult,
  BookmarkedReferenceItem,
  MaterializedReference,
  UsageLogPage,
  CreativeReferenceInsight,
  CreativeQualityCheck,
} from "./types";
import { withBrowserAuthLock } from "@/lib/session-device";
import type { CreativeDraft } from "@/lib/creative-brief";
import type { ChatContextStatus } from "@/lib/chat-context-types";

export const planCreativeBrief = (input: {
  instruction: string;
  brief: CreativeDraft["brief"];
  locked: CreativeDraft["locked"];
  hasBase: boolean;
  history?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  referenceSummary?: string;
}) =>
  request<Pick<CreativeDraft, "brief" | "questions"> & { message?: string }>(
    "/api/creative/plan",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

export const quoteCreativeGeneration = (input: {
  modelId: string;
  size?: string;
  outputFormat?: string;
  brief: CreativeDraft["brief"];
  baseReference: CreativeDraft["baseReference"];
}) =>
  request<{ estimatedCredits: number; prompt: string }>("/api/creative/quote", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const inspectCreativeReferences = (input: {
  referenceImageKeys: string[];
  sourceImageIds: string[];
}) =>
  request<CreativeReferenceInsight>("/api/creative/inspect", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const checkCreativeResult = (input: {
  generationId: string;
  imageId: string;
  brief: CreativeDraft["brief"];
}) =>
  request<CreativeQualityCheck>("/api/creative/check", {
    method: "POST",
    body: JSON.stringify(input),
  });

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  fallback = "请求失败，请稍后重试",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "网络连接失败，请检查网络", 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // 非 JSON 响应（如 502 网关错误）。
  }

  const envelope = payload as {
    ok?: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; details?: unknown };
  } | null;

  if (response.ok && envelope?.ok === true) {
    return envelope.data as T;
  }

  const code = envelope?.error?.code ?? `HTTP_${response.status}`;
  const message = envelope?.error?.message ?? fallback;
  throw new ApiError(code, message, response.status, envelope?.error?.details);
}

// ---------- 账户 ----------

export const getMe = () => request<Me>("/api/me");

export const updateMeName = (name: string | null) =>
  request<Me>("/api/me", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const redeemCode = (code: string) =>
  request<{ credits: number; balance: number }>("/api/me/redeem-code", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

export const listUsageLog = (params?: { limit?: number; cursor?: string }) => {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return request<UsageLogPage>(`/api/me/usage${qs ? `?${qs}` : ""}`);
};

export const logout = () =>
  withBrowserAuthLock(() =>
    request<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST" }),
  );

// ---------- 模型目录 ----------

export const listModels = () => request<ModelInfo[]>("/api/public/models");

// ---------- 生成 ----------

export function listGenerations(params?: {
  limit?: number;
  cursor?: string;
  status?: string;
}): Promise<GenerationListPage> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.cursor) search.set("cursor", params.cursor);
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();
  return request<GenerationListPage>(`/api/generations${qs ? `?${qs}` : ""}`);
}

export const getGeneration = (id: string) =>
  request<Generation>(`/api/generations/${id}`);

export const getGenerationForRetry = (id: string) =>
  request<
    Generation & {
      retryReferences: Array<{
        kind: "upload" | "source";
        key: string;
        previewUrl: string;
      }>;
    }
  >(`/api/generations/${id}?retry=1`);

export const createGeneration = (input: CreateGenerationInput) =>
  request<CreateGenerationResult>("/api/generations", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const cancelGeneration = (id: string) =>
  request<{ status: "CANCELED" }>(`/api/generations/${id}/cancel`, {
    method: "POST",
  });

export const clearGenerations = () =>
  request<{ cleared: number }>("/api/generations", { method: "DELETE" });

// ---------- 对话 ----------

export const listConversations = (limit = 30) =>
  request<{ items: ConversationSummary[] }>(
    `/api/conversations?limit=${limit}`,
  );

export const getConversation = (id: string) =>
  request<Conversation>(`/api/conversations/${id}`);

export const createConversation = (input: {
  title?: string;
  firstMessage?: string;
}) =>
  request<Conversation>("/api/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateConversation = (
  id: string,
  patch: { title?: string; archived?: boolean },
) =>
  request<Conversation>(`/api/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteConversation = (id: string) =>
  updateConversation(id, { archived: true });

export const archiveAllConversations = () =>
  request<{ archived: number }>("/api/conversations", { method: "DELETE" });

export const appendConversationMessages = (
  id: string,
  messages: ChatMessageInput[],
) =>
  request<Conversation>(`/api/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ messages }),
  });

export const clearConversationMessages = (id: string) =>
  request<{ deleted: number }>(`/api/conversations/${id}/messages`, {
    method: "DELETE",
  });

export const getConversationPricing = () =>
  request<ConversationPricing>("/api/conversations/chat");

export const getChatContext = (
  conversationId: string,
  modelId?: string,
  budgetTokens?: number,
) => {
  const search = new URLSearchParams({ conversationId });
  if (modelId) search.set("modelId", modelId);
  if (budgetTokens !== undefined)
    search.set("budgetTokens", String(budgetTokens));
  return request<ChatContextStatus>(
    `/api/conversations/context?${search.toString()}`,
  );
};

export const compactChatContext = (
  conversationId: string,
  modelId: string,
  budgetTokens?: number,
) =>
  request<ChatContextStatus>("/api/conversations/context", {
    method: "POST",
    body: JSON.stringify({ conversationId, modelId, budgetTokens }),
  });

export const compileConversationPrompt = (input: {
  modelId: string;
  image2Mode?: "standard" | "high";
  messages: ChatMessageInput[];
}) =>
  request<CompiledConversationPrompt>("/api/conversations/compile", {
    method: "POST",
    body: JSON.stringify(input),
  });

// ---------- 工具端点 ----------

export const optimizePrompt = (prompt: string) =>
  request<{ prompt: string; optimized: boolean }>("/api/prompt/optimize", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });

export async function uploadReferenceImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    response = await fetch("/api/upload", {
      method: "POST",
      credentials: "same-origin",
      body: formData,
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "网络连接失败，请检查网络", 0);
  }

  const envelope = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: UploadResult;
    error?: { code?: string; message?: string };
  } | null;

  if (response.ok && envelope?.ok === true && envelope.data) {
    return envelope.data;
  }

  throw new ApiError(
    envelope?.error?.code ?? `HTTP_${response.status}`,
    envelope?.error?.message ?? "上传失败",
    response.status,
  );
}

export const listBookmarkedReferences = () =>
  request<{ items: BookmarkedReferenceItem[] }>(
    "/api/inspiration/reference-library",
  );

export const materializeBookmarkedReferences = (mediaIds: string[]) =>
  request<{ references: MaterializedReference[] }>(
    "/api/inspiration/me/bookmarks/references",
    {
      method: "POST",
      body: JSON.stringify({ mediaIds }),
    },
  );

export const clearHistory = () =>
  request<{ conversations: number; generations: number }>("/api/history", {
    method: "DELETE",
  });

// ---------- PPT ----------

export const listPpts = () =>
  request<{ items: PptGeneration[] }>("/api/ppt/generate");

export const getPpt = (id: string) =>
  request<PptGeneration>(`/api/ppt/generate?id=${encodeURIComponent(id)}`);

export const createPpt = (input: CreatePptInput) =>
  request<PptGeneration>("/api/ppt/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const generatePptSlide = (input: {
  pptId: string;
  slideId: string;
  variablePrompt?: string;
}) =>
  request<{ slideId: string; generationId: string }>(
    "/api/ppt/generate-slide",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

export const enhancePptPrompt = (input: {
  prompt: string;
  theme: string;
  slideType:
    | "title"
    | "content"
    | "section"
    | "closing"
    | "image"
    | "quote"
    | "two-column";
}) =>
  request<{ enhancedPrompt: string }>("/api/ppt/enhance-prompt", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const pptExportUrl = (id: string) =>
  `/api/ppt/export?id=${encodeURIComponent(id)}`;
