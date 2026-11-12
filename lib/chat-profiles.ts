import { getLunaConfig } from "@/lib/luna-config";
import { getSolConfig } from "@/lib/sol-config";
import { getOpusConfig } from "@/lib/opus-config";
import {
  OPUS_MAX_INPUT_TOKENS,
  OPUS_MAX_OUTPUT_TOKENS,
  type ChatTokenPricingSnapshot,
} from "@/lib/chat-token-billing";
import {
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  OPUS_MODEL_ID,
  REASONING_EFFORTS,
} from "@/lib/chat-model-options";

async function getOpusProfile() {
  const config = await getOpusConfig();
  return {
    ...config,
    credits: 0,
    tokenPricing: {
      version: 1,
      pricing: config.pricing,
      maxInputTokens: OPUS_MAX_INPUT_TOKENS,
      maxOutputTokens: OPUS_MAX_OUTPUT_TOKENS,
    } satisfies ChatTokenPricingSnapshot,
    transport: "chat_completions_sse" as const,
    efforts: REASONING_EFFORTS as readonly string[],
    vision: true,
    webSearch: false,
  };
}

export async function getChatProfile(modelId: string) {
  // Keep the old id readable for existing drafts/turns, but never execute
  // its former DeepSeek configuration again.
  if (modelId === OPUS_MODEL_ID || modelId === "default") {
    return getOpusProfile();
  }
  if (modelId === SOL_MODEL_ID)
    return {
      ...(await getSolConfig()),
      transport: "responses_sse" as const,
      efforts: REASONING_EFFORTS as readonly string[],
      vision: true,
      webSearch: true,
    };
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
