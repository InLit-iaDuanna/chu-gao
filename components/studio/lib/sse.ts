import type { ChatMessageInput, Generation } from "./types";
import { OPUS_MODEL_ID, type ReasoningEffort } from "@/lib/chat-model-options";
import type { ChatTurnInput } from "@/lib/chat-turn-types";
import { streamManagedChat } from "./chat-turn-api";

export interface GenerationStreamHandlers {
  onUpdate: (generation: Generation) => void;
  onError?: (code: string, message: string) => void;
  onClose?: () => void;
}

export function subscribeGeneration(
  generationId: string,
  handlers: GenerationStreamHandlers,
): () => void {
  const source = new EventSource(`/api/generations/${generationId}/stream`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
    handlers.onClose?.();
  };
  source.addEventListener("update", (event) => {
    try {
      const generation = JSON.parse(
        (event as MessageEvent).data as string,
      ) as Generation;
      handlers.onUpdate(generation);
      if (["SUCCEEDED", "FAILED", "CANCELED"].includes(generation.status))
        close();
    } catch {
      /* Ignore malformed progress frames. */
    }
  });
  source.addEventListener("error", (event) => {
    const data = (event as MessageEvent).data;
    if (typeof data !== "string" || !data) return;
    try {
      const parsed = JSON.parse(data) as { code?: string; message?: string };
      handlers.onError?.(
        parsed.code ?? "STREAM_ERROR",
        parsed.message ?? "任务流中断",
      );
    } catch {
      handlers.onError?.("STREAM_ERROR", "任务流中断");
    }
    close();
  });
  return close;
}

export interface ChatStreamHandlers {
  onTurn?: (turn: import("@/lib/chat-turn-types").ChatTurnView) => void;
  onGeneration?: (generationId: string) => void;
  onConnection?: (state: "connected" | "reconnecting" | "disconnected") => void;
  onDelta: (content: string) => void;
  onReplace?: (content: string) => void;
  onReasoning?: (content: string) => void;
  onStatus?: (message: string) => void;
  onContext?: (
    status: import("@/lib/chat-context-types").ChatContextStatus,
  ) => void;
  onBilling?: (event: {
    credits: number;
    balance: number;
    refunded: boolean;
  }) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

// Old callers can adapt their input, but can never reopen the retired POST protocol.
export async function streamConversationChat(input: {
  messages: ChatMessageInput[];
  referenceImageKeys?: string[];
  sourceImageIds?: string[];
  references?: ChatTurnInput["references"];
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  webSearch?: boolean;
  conversationId?: string;
  userId?: string;
  reasoning?: boolean;
  durable?: boolean;
  signal?: AbortSignal;
  handlers: ChatStreamHandlers;
}): Promise<void> {
  if (input.signal?.aborted) return;
  if (!input.conversationId || !input.userId) {
    input.handlers.onError("对话身份尚未恢复，暂未提交任务");
    return;
  }
  try {
    await streamManagedChat({
      userId: input.userId,
      conversationId: input.conversationId,
      content: input.messages.at(-1)?.content ?? "",
      modelId: input.modelId ?? OPUS_MODEL_ID,
      reasoningEffort: input.reasoningEffort,
      webSearch: input.webSearch,
      referenceImageKeys: input.referenceImageKeys ?? [],
      sourceImageIds: input.sourceImageIds ?? [],
      ...(input.references ? { references: input.references } : {}),
      signal: input.signal,
      handlers: input.handlers,
    });
  } catch (error) {
    if (!input.signal?.aborted)
      input.handlers.onError(
        error instanceof Error ? error.message : "任务提交状态待确认",
      );
  }
}
