import { WELCOME_MESSAGE } from "@/components/workbench/lib/messages";
import { statusFromGeneration } from "@/components/workbench/lib/workbench-state";
import { useConversationStore } from "@/components/workbench/stores/conversation-store";
import { useGenerationStore } from "@/components/workbench/stores/generation-store";
import { useReferenceImageStore } from "@/components/workbench/stores/reference-image-store";
import type { WorkbenchGeneration } from "@/components/workbench/types";
import type { ConversationView } from "@/lib/conversation";

interface ApplyConversationOptions {
  closeGenerationStream: () => void;
  openGenerationStream: (generationId: string) => void;
}

function generationFromMessage(
  conversation: ConversationView,
  message: ConversationView["messages"][number],
): WorkbenchGeneration {
  return {
    id: message.generationId!,
    conversationId: conversation.id,
    prompt: message.generationPrompt ?? message.content,
    status: message.generationStatus ?? "SUCCEEDED",
    createdAt: message.createdAt ?? new Date().toISOString(),
    provider: message.generationProvider ?? null,
    providerChannelId: message.generationProviderChannelId ?? null,
    providerChannelName: message.generationProviderChannelName ?? null,
    providerAccountName: message.generationProviderAccountName ?? null,
    startedAt: message.generationStartedAt ?? null,
    finishedAt: message.generationFinishedAt ?? null,
    progress: message.generationProgress ?? null,
    images: message.images ?? [],
  };
}

function activeGenerationFromMessage(
  conversation: ConversationView,
  message: ConversationView["messages"][number],
): WorkbenchGeneration {
  const image =
    message.images ??
    (message.imageUrl || message.imageId
      ? [
          {
            id: message.imageId,
            src: message.imageUrl,
            url: message.imageUrl,
            downloadUrl: message.imageUrl,
            thumbnailUrl: message.thumbnailUrl,
          },
        ]
      : []);

  return {
    ...generationFromMessage(conversation, message),
    images: image,
  };
}

export function applyConversationToStores(
  conversation: ConversationView,
  { closeGenerationStream, openGenerationStream }: ApplyConversationOptions,
): void {
  closeGenerationStream();

  const conv = useConversationStore.getState();
  conv.setConversationId(conversation.id);
  conv.setConversationTitle(conversation.title);
  useReferenceImageStore.setState({ useCurrentImageAsReference: false });
  conv.setMessages(
    conversation.messages.length ? conversation.messages : [WELCOME_MESSAGE],
  );

  const conversationGenerations = conversation.messages
    .filter((message) => message.generationId)
    .map((message) => generationFromMessage(conversation, message));
  const lastGenerationMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.generationId);

  const gen = useGenerationStore.getState();

  if (lastGenerationMessage?.generationId) {
    const nextStatus = statusFromGeneration(
      lastGenerationMessage.generationStatus ?? "SUCCEEDED",
    );

    gen.setActiveGeneration(
      activeGenerationFromMessage(conversation, lastGenerationMessage),
    );
    gen.setStatus(nextStatus);
    gen.setProgress(
      lastGenerationMessage.generationProgress ??
        (nextStatus === "succeeded" ? 100 : 0),
    );

    if (nextStatus === "pending" || nextStatus === "running") {
      openGenerationStream(lastGenerationMessage.generationId);
    }
  } else {
    gen.setActiveGeneration(null);
    gen.setStatus("idle");
    gen.setProgress(0);
  }

  if (conversationGenerations.length > 0) {
    gen.setHistory((current) => {
      const merged = [...conversationGenerations, ...current];
      const unique = new Map<string, WorkbenchGeneration>();

      for (const item of merged) {
        unique.set(item.id, item);
      }

      return [...unique.values()].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    });
  }
}
