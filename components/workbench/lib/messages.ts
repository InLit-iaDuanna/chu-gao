import type { ConversationMessage } from "@/lib/conversation";

export const WELCOME_MESSAGE: ConversationMessage = {
  id: "welcome",
  role: "assistant",
  content: "你想先做哪张图？直接描述目标画面，也可以连续补充修改要求。",
  createdAt: new Date().toISOString(),
};

export function createMessage(
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function conversationTitleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "新的创作对话";
  }

  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
}
