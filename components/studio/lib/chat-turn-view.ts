import type { ChatTurnView } from "@/lib/chat-turn-types";
import type { Conversation } from "./types";

export type ManagedChatView = ChatTurnView & {
  activity?: string;
  searched?: boolean;
  createdAt?: string | null;
  startedAt?: string | null;
};

export function chatHasSearched(turn: { searched?: boolean; parts?: unknown }) {
  if (turn.searched) return true;
  const checkpoint = turn.parts as {
    items?: Array<{ type?: string; status?: string }>;
  } | null;
  return Boolean(
    Array.isArray(checkpoint?.items) &&
    checkpoint.items.some(
      (item) => item.type === "web_search_call" && item.status === "completed",
    ),
  );
}

export function mergeChatTurn(
  conversation: Conversation | null,
  turn: ManagedChatView,
  userContent?: string,
): Conversation | null {
  if (!conversation || conversation.id !== turn.conversationId)
    return conversation;
  const previous = conversation.messages.find(
    (message) =>
      message.chatAttemptId === turn.attemptId && message.role === "assistant",
  );
  if (
    previous?.chatLastSeq !== undefined &&
    previous.chatLastSeq > turn.lastSeq
  )
    return conversation;
  const latest = conversation.messages
    .filter(
      (message) =>
        message.chatTurnId === turn.id && message.role === "assistant",
    )
    .at(-1);
  if ((latest?.chatAttemptNumber ?? 0) > turn.attemptNumber)
    return conversation;
  const createdAt =
    previous?.chatStartedAt ??
    turn.createdAt ??
    turn.startedAt ??
    new Date().toISOString();
  const reply = {
    ...previous,
    id: previous?.id ?? `chat-assistant-${turn.attemptId}`,
    role: "assistant" as const,
    content: turn.text,
    chatTurnId: turn.id,
    chatAttemptId: turn.attemptId,
    chatAttemptNumber: turn.attemptNumber,
    chatLastSeq: turn.lastSeq,
    chatStatus: turn.status,
    chatActivity: turn.activity,
    chatSearched: chatHasSearched(turn),
    chatStartedAt: createdAt,
    chatSources: turn.sources,
    chatUsage: turn.usage,
    chatError: turn.error?.message ?? null,
    createdAt: previous?.createdAt ?? createdAt,
  };
  const messages = [...conversation.messages];
  if (
    userContent &&
    !messages.some(
      (message) => message.role === "user" && message.chatTurnId === turn.id,
    )
  ) {
    messages.push({
      id: `chat-user-${turn.id}`,
      role: "user",
      content: userContent,
      chatTurnId: turn.id,
      createdAt,
    });
  }
  const index = previous ? messages.indexOf(previous) : -1;
  if (index < 0) messages.push(reply);
  else messages[index] = reply;
  return { ...conversation, messages };
}
