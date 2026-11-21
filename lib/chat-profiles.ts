import { getLunaConfig } from "@/lib/luna-config";
import { getSolConfig, getAstraConfig } from "@/lib/sol-config";
import { getOpusConfig } from "@/lib/opus-config";
import { getPremiumAnthropicConfig } from "@/lib/premium-anthropic-config";
import { getGeminiConfig } from "@/lib/gemini-config";
import {
  OPUS_MAX_INPUT_TOKENS,
  OPUS_MAX_OUTPUT_TOKENS,
  type ChatTokenPricingSnapshot,
} from "@/lib/chat-token-billing";
import {
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  ASTRA_MODEL_ID,
  LEGACY_SOL_MODEL_ID,
  OPUS_MODEL_ID,
  FABLE_MODEL_ID,
  GEMINI_MODEL_IDS,
  PREMIUM_OPUS_MODEL_ID,
  REASONING_EFFORTS,
  GEMINI_REASONING_EFFORTS,
  type ChatTokenPricing,
} from "@/lib/chat-model-options";

function tokenProfile(
  config: Awaited<ReturnType<typeof getOpusConfig>>,
  maxInputTokens = OPUS_MAX_INPUT_TOKENS,
  transport:
    | "chat_completions_sse"
    | "anthropic_messages_sse" = "chat_completions_sse",
) {
  return {
    ...config,
    credits: 0,
    tokenPricing: {
      version: 1,
      pricing: config.pricing,
      maxInputTokens,
      maxOutputTokens: OPUS_MAX_OUTPUT_TOKENS,
    } satisfies ChatTokenPricingSnapshot,
    transport,
    efforts: REASONING_EFFORTS as readonly string[],
    vision: true,
    webSearch: transport === "anthropic_messages_sse",
  };
}

async function getOpusProfile() {
  return tokenProfile(
    await getOpusConfig(),
    OPUS_MAX_INPUT_TOKENS,
    "anthropic_messages_sse",
  );
}

async function getPremiumProfile(modelId: string) {
  return tokenProfile(
    await getPremiumAnthropicConfig(modelId),
    OPUS_MAX_INPUT_TOKENS,
    "anthropic_messages_sse",
  );
}

async function getGeminiProfile(modelId: string) {
  const config = await getGeminiConfig(modelId);
  return {
    ...config,
    credits: 0,
    tokenPricing: {
      version: 1,
      pricing: config.pricing,
      maxInputTokens: OPUS_MAX_INPUT_TOKENS,
      maxOutputTokens: OPUS_MAX_OUTPUT_TOKENS,
    } satisfies ChatTokenPricingSnapshot,
    transport: "responses_sse" as const,
    efforts: GEMINI_REASONING_EFFORTS as readonly string[],
    vision: true,
    webSearch: false,
  };
}

/**
 * Sol and Astra bill per token off the Opus 5.5 rate card, so they need the same
 * snapshot every Anthropic-profile call gets; only the gateway differs.
 */
function gptProfile(config: {
  enabled: boolean;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  multiplier: number;
  pricing: ChatTokenPricing;
}) {
  return {
    ...config,
    credits: 0,
    tokenPricing: {
      version: 1,
      pricing: config.pricing,
      maxInputTokens: OPUS_MAX_INPUT_TOKENS,
      maxOutputTokens: OPUS_MAX_OUTPUT_TOKENS,
    } satisfies ChatTokenPricingSnapshot,
    transport: "responses_sse" as const,
    efforts: REASONING_EFFORTS as readonly string[],
    vision: true,
    webSearch: true,
  };
}

export async function getChatProfile(modelId: string) {
  // Keep the old id readable for existing drafts/turns, but never execute
  // its former DeepSeek configuration again.
  if (modelId === OPUS_MODEL_ID || modelId === "default") {
    return getOpusProfile();
  }
  if (modelId === PREMIUM_OPUS_MODEL_ID || modelId === FABLE_MODEL_ID) {
    return getPremiumProfile(modelId);
  }
  if ((GEMINI_MODEL_IDS as readonly string[]).includes(modelId)) {
    return getGeminiProfile(modelId);
  }
  if (modelId === SOL_MODEL_ID || modelId === LEGACY_SOL_MODEL_ID)
    return gptProfile(await getSolConfig());
  if (modelId === ASTRA_MODEL_ID)
    return gptProfile(await getAstraConfig());
  if (modelId === LUNA_MODEL_ID)
    return {
      ...(await getLunaConfig()),
      transport: "responses_sse" as const,
      efforts: REASONING_EFFORTS as readonly string[],
      vision: true,
      webSearch: true,
    };
  throw new Error("Unknown conversation model");
}
