import { readApiResponse } from "@/components/workbench/lib/api-client";
import type { ChatRole } from "@/components/workbench/conversation-types";
import type {
  CompiledConversationPrompt,
  ConversationMessage,
  ConversationSummaryView,
  ConversationView,
} from "@/lib/conversation";
import type { WorkbenchGeneration } from "@/components/workbench/types";

export interface PersistableConversationMessage {
  role: ChatRole;
  content: string;
  generationId?: string;
}

export interface ConversationChatRequest {
  messages: unknown[];
  reasoning: boolean;
  signal: AbortSignal;
}

export interface ConversationPricingView {
  standardCredits: number;
  reasoningCredits: number;
}

export async function fetchConversationPricing(): Promise<ConversationPricingView> {
  return readApiResponse<ConversationPricingView>(
    await fetch("/api/conversations/chat", { cache: "no-store" }),
    "对话定价加载失败。",
  );
}

export interface ConversationGenerationPayload {
  conversationId?: string;
  modelId: string;
  image2Mode?: "standard" | "high";
  prompt: string;
  n: number;
  size?: string;
  responseFormat?: string;
  outputFormat?: string;
  background?: string | null;
  outputCompression?: number | null;
}

export interface ConversationGenerationResult {
  generationId: string;
  status?: string;
}

export async function fetchConversationSummaries(
  limit = 30,
): Promise<ConversationSummaryView[]> {
  const data = await readApiResponse<{ items?: ConversationSummaryView[] }>(
    await fetch(`/api/conversations?limit=${limit}`, { cache: "no-store" }),
    "历史对话加载失败。",
  );

  return data.items ?? [];
}

export async function fetchConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  const conversation = await readApiResponse<ConversationView>(
    await fetch(`/api/conversations/${conversationId}`, {
      cache: "no-store",
    }),
    "历史消息加载失败。",
  );

  return conversation.messages;
}

export async function createConversationFromFirstMessage(
  firstMessage: string,
): Promise<string> {
  const conversation = await readApiResponse<ConversationView>(
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstMessage: firstMessage.slice(0, 4000) }),
    }),
    "对话创建失败。",
  );

  return conversation.id;
}

export async function appendConversationMessages(
  conversationId: string,
  messages: PersistableConversationMessage[],
): Promise<void> {
  await readApiResponse<ConversationView>(
    await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    }),
    "聊天记录保存失败。",
  );
}

export async function archiveConversationById(
  conversationId: string,
): Promise<void> {
  await readApiResponse<ConversationView>(
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    }),
    "历史对话归档失败。",
  );
}

export async function requestConversationChat({
  messages,
  reasoning,
  signal,
}: ConversationChatRequest): Promise<Response> {
  return fetch("/api/conversations/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ messages, reasoning }),
  });
}

export async function compileConversationPrompt({
  modelId,
  image2Mode,
  messages,
}: {
  modelId: string;
  image2Mode?: "standard" | "high";
  messages: ConversationMessage[];
}): Promise<string> {
  const compiled = await readApiResponse<CompiledConversationPrompt>(
    await fetch("/api/conversations/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        messages,
        params: image2Mode ? { image2Mode } : {},
      }),
    }),
    "提示词编译失败，请重试。",
  );

  return compiled.prompt;
}

export async function submitConversationGeneration(
  payload: ConversationGenerationPayload,
): Promise<ConversationGenerationResult> {
  const result = await readApiResponse<{
    generationId?: string;
    status?: string;
  }>(
    await fetch("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    "出图请求提交失败。",
  );

  if (!result.generationId) {
    throw new Error("出图请求提交失败。");
  }

  return {
    generationId: result.generationId,
    status: result.status,
  };
}

export async function fetchGeneration(
  generationId: string,
): Promise<WorkbenchGeneration> {
  return readApiResponse<WorkbenchGeneration>(
    await fetch(`/api/generations/${generationId}`, {
      cache: "no-store",
    }),
    "任务状态读取失败。",
  );
}

export function clientErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}
