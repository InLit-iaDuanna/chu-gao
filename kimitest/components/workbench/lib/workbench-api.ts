import { readApiResponse } from "@/components/workbench/lib/api-client";
import type { UploadedReferenceImage } from "@/components/workbench/types";
import type { ConversationView } from "@/lib/conversation";

export type UploadedReferenceImageView = Omit<
  UploadedReferenceImage,
  "previewUrl"
>;

export interface UserView {
  id: string;
  credits: number;
}

export interface GenerationSubmitPayload {
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  modelId: string;
  image2Mode?: "standard" | "high";
  providerChannelId?: string | null;
  prompt: string;
  size: string;
  n: number;
  outputFormat: string;
  background?: string | null;
  outputCompression?: number | null;
  referenceImageKeys: string[];
  sourceImageIds: string[];
}

export interface GenerationSubmitResult {
  generationId: string;
  status: string;
  estimatedCredits: number;
  providerChannelId?: string | null;
  workerOnline?: boolean;
  queueWaiting?: number;
}

export async function fetchAccount(): Promise<UserView> {
  return readApiResponse<UserView>(
    await fetch("/api/me", { cache: "no-store" }),
    "账户状态暂时无法读取。",
  );
}

export async function createConversation(
  title: string,
): Promise<ConversationView> {
  return readApiResponse<ConversationView>(
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
    "对话创建失败。请稍后重试。",
  );
}

export async function deleteConversationMessages(
  conversationId: string,
): Promise<{ deleted: number }> {
  return readApiResponse<{ deleted: number }>(
    await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "DELETE",
    }),
    "聊天记录清空失败。",
  );
}

export async function updateConversationMessage(
  conversationId: string,
  messageId: string,
  content: string,
): Promise<ConversationView> {
  return readApiResponse<ConversationView>(
    await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),
    "消息编辑失败。",
  );
}

export async function archiveConversation(
  conversationId: string,
): Promise<ConversationView> {
  return readApiResponse<ConversationView>(
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    }),
    "历史对话删除失败。",
  );
}

export async function clearConversations(): Promise<{ archived: number }> {
  return readApiResponse<{ archived: number }>(
    await fetch("/api/conversations", { method: "DELETE" }),
    "历史对话清空失败。",
  );
}

export async function uploadReferenceImageFile(
  file: File,
): Promise<UploadedReferenceImageView> {
  const formData = new FormData();
  formData.append("file", file);

  return readApiResponse<UploadedReferenceImageView>(
    await fetch("/api/upload", { method: "POST", body: formData }),
    "参考图上传失败。",
  );
}

export async function submitGenerationRequest(
  payload: GenerationSubmitPayload,
): Promise<GenerationSubmitResult> {
  return readApiResponse<GenerationSubmitResult>(
    await fetch("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    "生成请求没有提交成功。请稍后重试。",
  );
}
