import type {
  ConversationMessage as StoredConversationMessage,
} from "@/lib/conversation";

import type { ChatMessage, ChatRole } from "./conversation-types";

export const RETENTION_NOTE =
  "聊天记录与生成图片仅保留 30 天，请及时下载或保存。";

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

let idCounter = 0;

export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

// 把本地聊天消息转换为 /api/conversations/chat 期望的多模态格式。
export function toChatRequestMessages(
  history: ChatMessage[],
): Array<{
  role: ChatRole;
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}> {
  return history
    // 出图卡片 / 错误气泡不参与对话上下文。
    .filter((message) => !message.generation && !message.isError)
    .map((message) => {
      const text = message.content.trim();

      if (message.role === "user" && message.images?.length) {
        const parts: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        > = [];
        if (text) {
          parts.push({ type: "text", text });
        }
        for (const url of message.images) {
          parts.push({ type: "image_url", image_url: { url } });
        }
        return { role: message.role, content: parts };
      }

      return { role: message.role, content: text || "（空消息）" };
    })
    .filter((message) =>
      typeof message.content === "string"
        ? message.content.length > 0
        : message.content.length > 0,
    );
}

// 编译 / 出图阶段把聊天转成纯文本消息（compile 端点只接受 string 内容）。
export function toPlainMessages(
  history: ChatMessage[],
): Array<{ role: ChatRole; content: string }> {
  return history
    .filter((message) => !message.generation && !message.isError)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0);
}

// 把已落库的会话消息水合成本地聊天消息：带 generationId 的渲染成出图卡片，其余为文本气泡。
export function fromStoredMessages(
  stored: StoredConversationMessage[],
): ChatMessage[] {
  return stored.map((message) => {
    if (message.generationId) {
      const image = message.images?.[0];
      return {
        id: message.id ?? nextId("gen"),
        role: "assistant",
        content: "",
        generation: {
          id: message.generationId,
          status: (message.generationStatus ?? "SUCCEEDED").toUpperCase(),
          progress: message.generationProgress ?? 100,
          imageUrl:
            message.imageUrl ??
            image?.src ??
            image?.url ??
            image?.thumbnailUrl ??
            null,
          downloadUrl: image?.downloadUrl ?? message.imageUrl ?? null,
          prompt: message.generationPrompt ?? message.content ?? "",
        },
      };
    }

    return {
      id: message.id ?? nextId(message.role),
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
    };
  });
}
