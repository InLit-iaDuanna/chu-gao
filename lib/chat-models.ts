import { getConversationPricing } from "@/lib/ai-config";
import { getLunaConfig } from "@/lib/luna-config";
import { getSolConfig } from "@/lib/sol-config";
import { getOpusConfig } from "@/lib/opus-config";
import { getPremiumAnthropicConfig } from "@/lib/premium-anthropic-config";
import { getGeminiConfig } from "@/lib/gemini-config";
import {
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  OPUS_MODEL_ID,
  PREMIUM_OPUS_MODEL_ID,
  FABLE_MODEL_ID,
  GEMINI_ARGON_MODEL_ID,
  GEMINI_CARBON_MODEL_ID,
  GEMINI_HYDROGEN_MODEL_ID,
  GEMINI_REASONING_EFFORTS,
  REASONING_EFFORTS,
  type ChatModelOption,
} from "@/lib/chat-model-options";

export async function getChatCatalog() {
  const [luna, pricing, sol, opus, premium, gemini] = await Promise.all([
    getLunaConfig(),
    getConversationPricing(),
    getSolConfig(),
    getOpusConfig(),
    getPremiumAnthropicConfig(PREMIUM_OPUS_MODEL_ID),
    getGeminiConfig(GEMINI_ARGON_MODEL_ID),
  ]);
  const models: ChatModelOption[] = [];
  if (opus.enabled && opus.apiKey)
    models.push({
      id: OPUS_MODEL_ID,
      displayName: "Opus 5.5",
      family: "Claude",
      reasoningEfforts: [...REASONING_EFFORTS],
      defaultReasoningEffort: "low",
      credits: 0,
      pricing: { ...opus.pricing },
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: true,
      supportsDurableTurns: true,
    });
  if (premium.enabled && premium.apiKey) {
    models.push({
      id: PREMIUM_OPUS_MODEL_ID,
      displayName: "Opus 5.5 高价",
      family: "Claude",
      reasoningEfforts: [...REASONING_EFFORTS],
      defaultReasoningEffort: "low",
      credits: 0,
      pricing: { ...premium.pricing },
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: true,
      supportsDurableTurns: true,
    });
    models.push({
      id: FABLE_MODEL_ID,
      displayName: "Fable 5.2",
      family: "Claude",
      reasoningEfforts: [...REASONING_EFFORTS],
      defaultReasoningEffort: "low",
      credits: 0,
      pricing: {
        ...premium.pricing,
        input: premium.pricing.input * 2,
        output: premium.pricing.output * 2,
        cacheRead: premium.pricing.cacheRead * 2,
        cacheCreation: premium.pricing.cacheCreation * 2,
      },
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: true,
      supportsDurableTurns: true,
    });
  }
  if (gemini.enabled && gemini.apiKey) {
    for (const [id, displayName] of [
      [GEMINI_ARGON_MODEL_ID, "Gemini 4 Argon"],
      [GEMINI_CARBON_MODEL_ID, "Gemini 4 Carbon"],
      [GEMINI_HYDROGEN_MODEL_ID, "Gemini 4 Hydrogen"],
    ] as const) {
      models.push({
        id,
        displayName,
        family: "Gemini 4",
        reasoningEfforts: [...GEMINI_REASONING_EFFORTS],
        defaultReasoningEffort: "medium",
        credits: 0,
        pricing:
          id === GEMINI_HYDROGEN_MODEL_ID
            ? {
                ...gemini.pricing,
                input: gemini.pricing.input / 2,
                output: gemini.pricing.output / 2,
                cacheRead: gemini.pricing.cacheRead / 2,
                cacheCreation: gemini.pricing.cacheCreation / 2,
              }
            : { ...gemini.pricing },
        supportsVision: true,
        maxReferenceImages: 8,
        supportsWebSearch: false,
        supportsDurableTurns: true,
      });
    }
  }
  if (sol.enabled && sol.apiKey)
    models.push({
      id: SOL_MODEL_ID,
      displayName: "GPT-6.1 Sol",
      family: "GPT",
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
      family: "GPT",
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
