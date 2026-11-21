import { getConversationPricing } from "@/lib/ai-config";
import { getSolConfig, getAstraConfig } from "@/lib/sol-config";
import { getOpusConfig } from "@/lib/opus-config";
import { getPremiumAnthropicConfig } from "@/lib/premium-anthropic-config";
import { getGeminiConfig } from "@/lib/gemini-config";
import {
  SOL_MODEL_ID,
  ASTRA_MODEL_ID,
  OPUS_MODEL_ID,
  PREMIUM_OPUS_MODEL_ID,
  FABLE_MODEL_ID,
  GEMINI_ARGON_MODEL_ID,
  GEMINI_CARBON_MODEL_ID,
  GEMINI_HYDROGEN_MODEL_ID,
  GEMINI_REASONING_EFFORTS,
  REASONING_EFFORTS,
  chatPriceMultiplier,
  type ChatModelOption,
  type ChatTokenPricing,
} from "@/lib/chat-model-options";

export async function getChatCatalog() {
  const [pricing, sol, astra, opus, premium, gemini] = await Promise.all([
    getConversationPricing(),
    getSolConfig(),
    getAstraConfig(),
    getOpusConfig(),
    getPremiumAnthropicConfig(PREMIUM_OPUS_MODEL_ID),
    getGeminiConfig(GEMINI_ARGON_MODEL_ID),
  ]);
  // Every price is shown relative to the Opus 5.5 rate card.
  const base: ChatTokenPricing = opus.pricing;
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
      multiplier: 1,
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
      multiplier: chatPriceMultiplier(premium.pricing, base),
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
      multiplier: chatPriceMultiplier(
        {
          type: "per_million_tokens",
          input: premium.pricing.input * 2,
          output: premium.pricing.output * 2,
          cacheRead: premium.pricing.cacheRead * 2,
          cacheCreation: premium.pricing.cacheCreation * 2,
        },
        base,
      ),
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
        multiplier: chatPriceMultiplier(
          id === GEMINI_HYDROGEN_MODEL_ID
            ? {
                type: "per_million_tokens",
                input: gemini.pricing.input / 2,
                output: gemini.pricing.output / 2,
                cacheRead: gemini.pricing.cacheRead / 2,
                cacheCreation: gemini.pricing.cacheCreation / 2,
              }
            : gemini.pricing,
          base,
        ),
        supportsVision: true,
        maxReferenceImages: 8,
        supportsWebSearch: false,
        supportsDurableTurns: true,
      });
    }
  }
  for (const [id, displayName, config] of [
    [SOL_MODEL_ID, "GPT-6.2 Sol", sol],
    [ASTRA_MODEL_ID, "GPT-6.2 Astra", astra],
  ] as const)
    if (config.enabled && config.apiKey)
      models.push({
        id,
        displayName,
        family: "GPT",
        reasoningEfforts: [...REASONING_EFFORTS],
        defaultReasoningEffort: "low",
        credits: 0,
        pricing: { ...config.pricing },
        multiplier: config.multiplier,
        supportsVision: true,
        maxReferenceImages: 8,
        supportsWebSearch: true,
        supportsDurableTurns: true,
      });
  // Luna 5.6 is retired: the gateway no longer lists it. Its profile stays
  // mapped so stored turns still resolve.
  return {
    ...pricing,
    models,
    defaultModelId:
      models.find((model) => model.id === OPUS_MODEL_ID)?.id ??
      models[0]?.id ??
      "",
  };
}
