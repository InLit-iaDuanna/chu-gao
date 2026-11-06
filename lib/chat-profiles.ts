import { getConversationConfig, getConversationPricing } from "@/lib/ai-config";
import { getLunaConfig } from "@/lib/luna-config";
import { getSolConfig } from "@/lib/sol-config";
import {
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  REASONING_EFFORTS,
} from "@/lib/chat-model-options";

export async function getChatProfile(modelId: string) {
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
  if (modelId !== "default") throw new Error("Unknown conversation model");
  const [config, pricing] = await Promise.all([
    getConversationConfig(),
    getConversationPricing(),
  ]);
  return {
    ...config,
    credits: pricing.standardCredits,
    transport: "chat_completions_sse" as const,
    efforts: [] as readonly string[],
    vision: true,
    webSearch: false,
  };
}
