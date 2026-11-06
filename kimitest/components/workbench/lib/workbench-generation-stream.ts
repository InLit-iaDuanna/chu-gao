import type { MutableRefObject } from "react";

import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { fetchGeneration } from "@/components/workbench/conversation-mode-api";
import { statusFromGeneration } from "@/components/workbench/lib/workbench-state";
import { useConversationStore } from "@/components/workbench/stores/conversation-store";
import { useGenerationStore } from "@/components/workbench/stores/generation-store";
import type { WorkbenchGeneration } from "@/components/workbench/types";
import type { ErrorScope } from "@/components/workbench/stores/error-store";

interface GenerationStreamOptions {
  eventSourceRef: MutableRefObject<EventSource | null>;
  setError: (scope: ErrorScope, message: string | null) => void;
  appendAssistantError: (message: string) => void;
  loadMe: () => void | Promise<void>;
}

export function closeGenerationStream(
  eventSourceRef: MutableRefObject<EventSource | null>,
): void {
  eventSourceRef.current?.close();
  eventSourceRef.current = null;
}

export function mergeGeneration(next: WorkbenchGeneration): void {
  useGenerationStore.getState().mergeGeneration(next);

  if (!next.conversationId) {
    return;
  }

  const latestImage = next.images.at(-1);
  const imageUrl = latestImage?.src ?? latestImage?.url ?? null;
  const thumbnailUrl = latestImage?.thumbnailUrl ?? imageUrl;

  useConversationStore.getState().setConversations((current) =>
    current.map((item) =>
      item.id === next.conversationId
        ? {
            ...item,
            lastMessageAt: new Date().toISOString(),
            thumbnailUrl: thumbnailUrl ?? item.thumbnailUrl,
            generationCount: Math.max(item.generationCount, 1),
          }
        : item,
    ),
  );
}

function finishGenerationStream(
  events: EventSource,
  eventSourceRef: MutableRefObject<EventSource | null>,
  loadMe: () => void | Promise<void>,
): void {
  events.close();
  eventSourceRef.current = null;
  void loadMe();
}

export function openGenerationStream(
  generationId: string,
  {
    eventSourceRef,
    setError,
    appendAssistantError,
    loadMe,
  }: GenerationStreamOptions,
): void {
  eventSourceRef.current?.close();

  const events = new EventSource(`/api/generations/${generationId}/stream`);
  eventSourceRef.current = events;

  const applyUpdate = (next: WorkbenchGeneration) => {
    mergeGeneration(next);

    const nextStatus = statusFromGeneration(next.status);
    const gen = useGenerationStore.getState();
    gen.setStatus(nextStatus);

    if (nextStatus === "pending") {
      gen.setProgress(next.progress ?? 12);
      gen.setQueueNotice(
        (current) => current ?? "任务正在等待生成 worker 消费。",
      );
    }

    if (nextStatus === "running") {
      gen.setProgress(next.progress ?? 62);
      gen.setQueueNotice(null);
    }

    if (nextStatus === "failed") {
      gen.setProgress(0);
      gen.setQueueNotice(null);
      const message = friendlyErrorMessage(
        {
          code: next.errorCode ?? undefined,
          message: next.errorMessage ?? undefined,
        },
        "生成没有完成。请稍后重试，或换一个模型再发送。",
      );
      setError("generation", message);
      appendAssistantError(message);
    }

    if (nextStatus === "succeeded") {
      const latestImage = next.images.at(-1);
      gen.setProgress(100);
      gen.setQueueNotice(null);
      useConversationStore.getState().setMessages((current) =>
        current.map((message) =>
          message.generationId === next.id
            ? {
                ...message,
                imageId: latestImage?.id,
                imageUrl: latestImage?.src ?? latestImage?.url,
                images: next.images,
                thumbnailUrl: latestImage?.thumbnailUrl,
                generationStatus: next.status,
                generationProvider: next.provider ?? null,
                generationProviderChannelId: next.providerChannelId ?? null,
                generationProviderChannelName:
                  next.providerChannelName ?? null,
                generationProviderAccountName:
                  next.providerAccountName ?? null,
                generationPrompt: next.prompt,
                generationStartedAt: next.startedAt ?? null,
                generationFinishedAt: next.finishedAt ?? null,
                generationProgress: next.progress ?? 100,
              }
            : message,
        ),
      );
    }

    if (
      nextStatus === "succeeded" ||
      nextStatus === "failed" ||
      nextStatus === "canceled"
    ) {
      finishGenerationStream(events, eventSourceRef, loadMe);
    }
  };

  events.addEventListener("update", (event) => {
    const next = JSON.parse(
      (event as MessageEvent).data,
    ) as WorkbenchGeneration;
    applyUpdate(next);
  });

  events.addEventListener("error", (event) => {
    let message = "无法继续接收任务状态。请刷新页面查看结果，或稍后重试。";
    const data = (event as MessageEvent).data;

    if (typeof data === "string" && data) {
      try {
        const parsed = JSON.parse(data) as {
          code?: string;
          message?: string;
        };
        message = friendlyErrorMessage(parsed, message);
      } catch {
        message = friendlyErrorMessage(data, message);
      }
    }

    void fetchGeneration(generationId)
      .then((generation) => {
        const status = statusFromGeneration(generation.status);
        if (
          status === "succeeded" ||
          status === "failed" ||
          status === "canceled"
        ) {
          applyUpdate(generation);
          return;
        }

        const gen = useGenerationStore.getState();
        gen.setStatus("failed");
        gen.setProgress(0);
        setError("generation", message);
        appendAssistantError(message);
        finishGenerationStream(events, eventSourceRef, loadMe);
      })
      .catch(() => {
        const gen = useGenerationStore.getState();
        gen.setStatus("failed");
        gen.setProgress(0);
        setError("generation", message);
        appendAssistantError(message);
        finishGenerationStream(events, eventSourceRef, loadMe);
      });
  });
}
