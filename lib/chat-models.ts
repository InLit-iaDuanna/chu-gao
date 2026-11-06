import { getConversationConfig, getConversationPricing } from "@/lib/ai-config";
import { getLunaConfig } from "@/lib/luna-config";
import { getSolConfig } from "@/lib/sol-config";
import {
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  REASONING_EFFORTS,
  type ChatModelOption,
} from "@/lib/chat-model-options";

export async function getChatCatalog() {
  const [legacy, luna, pricing, sol] = await Promise.all([
    getConversationConfig(),
    getLunaConfig(),
    getConversationPricing(),
    getSolConfig(),
  ]);
  const models: ChatModelOption[] = [];
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
  if (legacy.enabled && legacy.apiKey)
    models.push({
      id: "default",
      displayName: legacy.model.startsWith("deepseek")
        ? "DeepSeek"
        : legacy.model,
      reasoningEfforts: [],
      credits: pricing.standardCredits,
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: false,
      supportsDurableTurns: true,
    });
  return { ...pricing, models, defaultModelId: models[0]?.id ?? "" };
}
