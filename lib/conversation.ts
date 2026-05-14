export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  id?: string;
  role: ConversationRole;
  content: string;
  generationId?: string;
  imageId?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  generationStatus?: string;
  generationProvider?: string | null;
  generationProviderChannelId?: string | null;
  generationProviderChannelName?: string | null;
  generationProviderAccountName?: string | null;
  generationStartedAt?: string | null;
  generationFinishedAt?: string | null;
  generationProgress?: number | null;
  createdAt?: string;
}

export interface CompiledConversationPrompt {
  prompt: string;
  assistantMessage: string;
  shouldGenerate: boolean;
  compiler: string;
  fallbackReason?: string;
}

export interface ConversationView {
  id: string;
  title: string;
  lastMessageAt: string;
  createdAt: string;
  messages: ConversationMessage[];
}

export interface ConversationSummaryView {
  id: string;
  title: string;
  lastMessageAt: string;
  createdAt: string;
  latestMessage: string | null;
  thumbnailUrl: string | null;
  generationCount: number;
}

export function trimConversationMessages(
  messages: ConversationMessage[],
  options: {
    maxMessages?: number;
    maxContentLength?: number;
  } = {},
): ConversationMessage[] {
  const maxMessages = options.maxMessages ?? 40;
  const maxContentLength = options.maxContentLength ?? 1200;

  return messages
    .filter((message) => message.content.trim())
    .slice(-maxMessages)
    .map((message) => ({
      ...message,
      content:
        message.content.length > maxContentLength
          ? `${message.content.slice(0, maxContentLength).trim()}...`
          : message.content.trim(),
    }));
}

export function compilePromptFallback(
  messages: ConversationMessage[],
  fallbackReason?: string,
): CompiledConversationPrompt {
  const recentMessages = messages
    .filter((message) => message.content.trim())
    .slice(-8)
    .map((message, index) => {
      const role = message.role === "user" ? "用户" : "助手";
      const imageContext = message.generationId
        ? `（关联任务 ${message.generationId}）`
        : "";

      return `第 ${index + 1} 轮 ${role}${imageContext}：${message.content.trim()}`;
    });
  const userMessages = messages.filter((message) => message.role === "user");
  const lastUserMessage =
    userMessages[userMessages.length - 1]?.content.trim() ?? "";
  const prompt = [
    "根据以下连续创作上下文生成一张图像。",
    "保留用户明确要求延续的主体、风格、构图和限制；助手消息可作为已确认状态参考；新的用户要求优先级最高。",
    "",
    ...recentMessages,
    "",
    `最终画面要求：${lastUserMessage}`,
  ].join("\n");

  return {
    prompt,
    assistantMessage: "已根据上下文整理为新的出图任务。",
    shouldGenerate: Boolean(lastUserMessage),
    compiler: "fallback",
    fallbackReason,
  };
}
