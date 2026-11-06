import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { fetchGeneration } from "@/components/workbench/conversation-mode-api";
import type { ChatMessage } from "@/components/workbench/conversation-types";
import type { WorkbenchGeneration } from "@/components/workbench/types";

interface WatchConversationGenerationOptions {
  generationId: string;
  generationStreamRef: MutableRefObject<EventSource | null>;
  messageId: string;
  setIsGenerating: (value: boolean) => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
}

export function watchConversationGeneration({
  generationId,
  generationStreamRef,
  messageId,
  setIsGenerating,
  setMessages,
  updateMessage,
}: WatchConversationGenerationOptions): void {
  generationStreamRef.current?.close();
  const events = new EventSource(`/api/generations/${generationId}/stream`);
  generationStreamRef.current = events;

  const finish = () => {
    events.close();
    if (generationStreamRef.current === events) {
      generationStreamRef.current = null;
    }
    setIsGenerating(false);
  };

  const applyUpdate = (next: WorkbenchGeneration): boolean => {
    const latest = next.images.at(-1);
    const imageUrl = latest?.src ?? latest?.url ?? null;
    const downloadUrl = latest?.downloadUrl ?? imageUrl;
    const status = next.status.toUpperCase();

    setMessages((current) =>
      current.map((message) =>
        message.id === messageId && message.generation
          ? {
              ...message,
              generation: {
                ...message.generation,
                status,
                progress: next.progress ?? message.generation.progress,
                imageUrl: imageUrl ?? message.generation.imageUrl,
                downloadUrl:
                  downloadUrl ?? message.generation.downloadUrl ?? null,
              },
            }
          : message,
      ),
    );

    if (status === "FAILED" || status === "CANCELED") {
      updateMessage(messageId, {
        generation: undefined,
        isError: true,
        content: next.errorMessage ?? "出图失败，请稍后重试或调整提示词。",
      });
      finish();
      return true;
    }

    if (status === "SUCCEEDED") {
      finish();
      return true;
    }

    return false;
  };

  events.addEventListener("update", (event) => {
    let next: WorkbenchGeneration;
    try {
      next = JSON.parse((event as MessageEvent).data) as WorkbenchGeneration;
    } catch {
      return;
    }

    applyUpdate(next);
  });

  events.addEventListener("error", () => {
    void fetchGeneration(generationId)
      .then((generation) => {
        if (!applyUpdate(generation)) {
          updateMessage(messageId, {
            generation: undefined,
            isError: true,
            content: "无法接收出图状态，请刷新页面查看结果。",
          });
          finish();
        }
      })
      .catch(() => {
        updateMessage(messageId, {
          generation: undefined,
          isError: true,
          content: "无法接收出图状态，请刷新页面查看结果。",
        });
        finish();
      });
  });
}
