export const LUNA_MODEL_ID = "gpt-5.6-luna";
export const SOL_MODEL_ID = "gpt-6.2-sol";
export const ASTRA_MODEL_ID = "gpt-6.2-astra";
/** Retired 6.1 id: still accepted so open tabs and drafts keep working. */
export const LEGACY_SOL_MODEL_ID = "gpt-6.1-sol";
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

export const GPT_MODEL_IDS = [LUNA_MODEL_ID, SOL_MODEL_ID, ASTRA_MODEL_ID] as const;
export const RETIRED_CHAT_MODEL_IDS = [LEGACY_SOL_MODEL_ID] as const;

export function isGptModelId(
  modelId: string,
): modelId is (typeof GPT_MODEL_IDS)[number] {
  return (GPT_MODEL_IDS as readonly string[]).includes(modelId);
}

export const CHAT_MODEL_IDS = [
  "default",
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  ASTRA_MODEL_ID,
  OPUS_MODEL_ID,
  PREMIUM_OPUS_MODEL_ID,
  FABLE_MODEL_ID,
  ...GEMINI_MODEL_IDS,
] as const;

export type ChatModelId = (typeof CHAT_MODEL_IDS)[number];

/** Selectable ids plus retired ones that must keep resolving for stored turns. */
export const ACCEPTED_CHAT_MODEL_IDS = [
  ...CHAT_MODEL_IDS,
  ...RETIRED_CHAT_MODEL_IDS,
] as const;

export function isAcceptedChatModelId(modelId: string): boolean {
  return (ACCEPTED_CHAT_MODEL_IDS as readonly string[]).includes(modelId);
}

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
    modelId === SOL_MODEL_ID ||
    modelId === ASTRA_MODEL_ID ||
    modelId === LEGACY_SOL_MODEL_ID ||
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
  /** Retail price as a multiple of the Opus 5.5 base rates (see below). */
  multiplier?: number;
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

/**
 * Every chat price is the Opus 5.5 route's rate card times a multiplier, so one
 * admin edit to Opus repriced the whole catalog consistently.
 */
export const CHAT_PRICE_BASE_MODEL_ID = OPUS_MODEL_ID;

export const CHAT_MODEL_MULTIPLIERS: Readonly<Record<string, number>> = {
  [OPUS_MODEL_ID]: 1,
  [SOL_MODEL_ID]: 0.8,
  [ASTRA_MODEL_ID]: 4,
};

const roundRate = (value: number) => Number(value.toFixed(6));

/** All four token rates scaled by `multiplier`; the shape stays identical. */
export function scaleChatPricing(
  base: ChatTokenPricing,
  multiplier: number,
): ChatTokenPricing {
  return {
    type: "per_million_tokens",
    input: roundRate(base.input * multiplier),
    output: roundRate(base.output * multiplier),
    cacheRead: roundRate(base.cacheRead * multiplier),
    cacheCreation: roundRate(base.cacheCreation * multiplier),
  };
}

/**
 * Display multiplier for a rate card nobody declared: output is the rate a turn
 * actually spends against, so it is the honest single number to show.
 */
export function chatPriceMultiplier(
  pricing: ChatTokenPricing | undefined,
  base: ChatTokenPricing,
): number | undefined {
  if (!pricing || base.output <= 0) return undefined;
  return Number((pricing.output / base.output).toFixed(2));
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

/** Sol and Astra share one channel: same gateway and key, separate switches. */
export interface GptStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  multiplier: number;
  pricing: ChatTokenPricing;
}

export interface GptConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
}

export interface LunaConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  credits?: number;
}
