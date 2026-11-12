import { getConversationPricing } from "@/lib/ai-config";
import { getLunaConfig } from "@/lib/luna-config";
import { getSolConfig } from "@/lib/sol-config";
import { getOpusConfig } from "@/lib/opus-config";
import {
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  OPUS_MODEL_ID,
  REASONING_EFFORTS,
  type ChatModelOption,
} from "@/lib/chat-model-options";

export async function getChatCatalog() {
  const [luna, pricing, sol, opus] = await Promise.all([
    getLunaConfig(),
    getConversationPricing(),
    getSolConfig(),
    getOpusConfig(),
  ]);
  const models: ChatModelOption[] = [];
  if (opus.enabled && opus.apiKey)
    models.push({
      id: OPUS_MODEL_ID,
      displayName: "Opus 5.5",
      reasoningEfforts: [...REASONING_EFFORTS],
      defaultReasoningEffort: "low",
      credits: 0,
      pricing: { ...opus.pricing },
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: false,
      supportsDurableTurns: true,
    });
  if (sol.enabled && sol.apiKey)
    models.push({
      id: SOL_MODEL_ID,
      displayName: "GPT-6.1 Sol",
      reasoningEfforts: [...REASONING_EFFORTS],
      defaultReasoningEffort: "low",
      credits: sol.credits,
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: true,
      supportsDurableTurns: true,
    });
  if (luna.enabled && luna.apiKey)
    models.push({
      id: LUNA_MODEL_ID,
      displayName: "GPT-5.6 Luna",
      reasoningEfforts: [...REASONING_EFFORTS],
      defaultReasoningEffort: "medium",
      credits: luna.credits,
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: true,
      supportsDurableTurns: true,
    });
  return {
    ...pricing,
    models,
    defaultModelId:
      models.find((model) => model.id === OPUS_MODEL_ID)?.id ??
      models[0]?.id ??
      "",
  };
}
