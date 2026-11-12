import type { ConversationMessage, Generation } from "../lib/types";

export function messageGeneration(
  message: ConversationMessage,
  conversationId: string,
): Generation | null {
  if (!message.generationId || message.role !== "assistant") return null;
  return {
    id: message.generationId,
    conversationId,
    modelId: message.generationModelId ?? "",
    prompt: message.generationPrompt ?? message.content,
    negativePrompt: null,
    aspectRatio: null,
    resolution: null,
    size: message.generationSize,
    n: message.generationCount ?? 1,
    outputFormat: null,
    referenceImageKeys: [],
    status: message.generationStatus ?? "PENDING",
    provider: null,
    providerChannelId: null,
    providerChannelName: null,
    providerAccountName: null,
    progress: message.generationProgress ?? 0,
    errorCode: message.generationErrorCode ?? null,
    errorMessage: message.generationErrorMessage ?? null,
    credits: message.generationCostCredits ?? 0,
    costCredits: message.generationCostCredits ?? 0,
    billing: message.generationBilling,
    attempts: 0,
    startedAt: message.generationStartedAt ?? null,
    finishedAt: message.generationFinishedAt ?? null,
    createdAt: message.createdAt,
    images: message.images ?? [],
  };
}
