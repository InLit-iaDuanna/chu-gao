export const LUNA_MODEL_ID = "gpt-5.6-luna";
export const SOL_MODEL_ID = "gpt-6.1-sol";
export const OPUS_MODEL_ID = "claude-opus-5-5";
// The premium Anthropic route uses private catalog ids so it can coexist with
// the existing lower-cost Opus route without exposing provider channels.
export const PREMIUM_OPUS_MODEL_ID = "claude-opus-5-5-premium";
export const FABLE_MODEL_ID = "claude-fable-5-2";
export const GEMINI_ARGON_MODEL_ID = "gemini-4-argon";
export const GEMINI_CARBON_MODEL_ID = "gemini-4-carbon";
export const GEMINI_HYDROGEN_MODEL_ID = "gemini-4-hydrogen";
export const GEMINI_MODEL_IDS = [
  GEMINI_ARGON_MODEL_ID,
  GEMINI_CARBON_MODEL_ID,
  GEMINI_HYDROGEN_MODEL_ID,
] as const;
export const PREMIUM_ANTHROPIC_MODEL_IDS = [
  PREMIUM_OPUS_MODEL_ID,
  FABLE_MODEL_ID,
] as const;
export const REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const GEMINI_REASONING_EFFORTS = ["low", "medium", "high"] as const;

export const CHAT_MODEL_IDS = [
  "default",
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  OPUS_MODEL_ID,
  PREMIUM_OPUS_MODEL_ID,
  FABLE_MODEL_ID,
  ...GEMINI_MODEL_IDS,
] as const;

export type ChatModelId = (typeof CHAT_MODEL_IDS)[number];

export function isGeminiModelId(
  modelId: string,
): modelId is (typeof GEMINI_MODEL_IDS)[number] {
  return (GEMINI_MODEL_IDS as readonly string[]).includes(modelId);
}

/** The upstream exposes Gemini effort variants as separate model ids. */
export function geminiUpstreamModel(
  modelId: string,
  effort?: ReasoningEffort,
): string {
  if (!isGeminiModelId(modelId)) return modelId;
  return effort &&
    GEMINI_REASONING_EFFORTS.includes(
      effort as (typeof GEMINI_REASONING_EFFORTS)[number],
    )
    ? `${modelId}-${effort}`
    : modelId;
}

export function isTokenPricedChatModel(modelId: string): boolean {
  return (
    modelId === OPUS_MODEL_ID ||
    modelId === PREMIUM_OPUS_MODEL_ID ||
    modelId === FABLE_MODEL_ID ||
    isGeminiModelId(modelId)
  );
}

export interface ChatModelOption {
  id: string;
  displayName: string;
  family?: "Claude" | "Gemini 4" | "GPT";
  reasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  credits: number;
  pricing?: ChatTokenPricing;
  supportsVision: boolean;
  maxReferenceImages: number;
  supportsWebSearch?: boolean;
  supportsDurableTurns?: boolean;
}

export interface ChatTokenPricing {
  type: "per_million_tokens";
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface OpusStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  pricing: ChatTokenPricing;
}

export interface OpusConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  pricing?: Partial<Omit<ChatTokenPricing, "type">>;
}

export interface PremiumAnthropicStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  models: string[];
  hasKey: boolean;
  pricing: ChatTokenPricing;
}

export interface PremiumAnthropicConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  pricing?: Partial<Omit<ChatTokenPricing, "type">>;
}

export interface GeminiStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  models: string[];
  hasKey: boolean;
  pricing: ChatTokenPricing;
}

export interface GeminiConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  pricing?: Partial<Omit<ChatTokenPricing, "type">>;
}

export interface LunaStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  credits: number;
}

export interface LunaConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  credits?: number;
}
