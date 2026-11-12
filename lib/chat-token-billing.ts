import { Prisma } from "@prisma/client";
import type { ChatTokenPricing } from "@/lib/chat-model-options";

export const OPUS_MAX_INPUT_TOKENS = 1_000_000;
export const OPUS_MAX_OUTPUT_TOKENS = 16_384;
// Vision inputs are resized by creative-vision; allow well above their tile cost.
export const OPUS_IMAGE_TOKEN_BOUND = 16_384;

export interface ChatTokenPricingSnapshot {
  version: 1;
  pricing: ChatTokenPricing;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function readChatTokenPricingSnapshot(
  value: unknown,
): ChatTokenPricingSnapshot | null {
  if (value === undefined || value === null) return null;
  const snapshot = object(value);
  const pricing = object(snapshot.pricing);
  if (
    snapshot.version !== 1 ||
    pricing.type !== "per_million_tokens" ||
    !validCount(snapshot.maxInputTokens) ||
    !validCount(snapshot.maxOutputTokens) ||
    snapshot.maxInputTokens === 0 ||
    snapshot.maxOutputTokens === 0 ||
    ![
      pricing.input,
      pricing.output,
      pricing.cacheRead,
      pricing.cacheCreation,
    ].every(
      (rate) =>
        typeof rate === "number" &&
        Number.isFinite(rate) &&
        rate >= 0 &&
        rate <= 1_000_000,
    )
  )
    throw new Error("INVALID_CHAT_TOKEN_PRICING_SNAPSHOT");
  return structuredClone(value) as ChatTokenPricingSnapshot;
}

export function normalizeChatTokenUsage(
  value: unknown,
):
  | { availability: "reported"; tokens: ChatTokenUsage }
  | { availability: "unknown"; reason: string } {
  const usage = object(value);
  if (usage.usage_segments !== undefined) {
    if (
      !Array.isArray(usage.usage_segments) ||
      !usage.usage_segments.length ||
      usage.usage_segments.length > 3
    )
      return { availability: "unknown", reason: "invalid_usage_segments" };
    const totals: ChatTokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
    };
    for (const segment of usage.usage_segments) {
      if (object(segment).usage_segments !== undefined)
        return { availability: "unknown", reason: "nested_usage_segments" };
      const result = normalizeChatTokenUsage(segment);
      if (result.availability !== "reported")
        return {
          availability: "unknown",
          reason: "recovery_segment_usage_unknown",
        };
      for (const key of Object.keys(totals) as Array<keyof ChatTokenUsage>) {
        totals[key] += result.tokens[key];
        if (!validCount(totals[key]))
          return {
            availability: "unknown",
            reason: "invalid_usage_segment_total",
          };
      }
    }
    return { availability: "reported", tokens: totals };
  }
  const openai = usage.prompt_tokens !== undefined;
  const input = openai ? usage.prompt_tokens : usage.input_tokens;
  // Some gateways report output_tokens:0 alongside a real completion_tokens value.
  const output =
    usage.completion_tokens !== undefined
      ? usage.completion_tokens
      : usage.output_tokens;
  const details = object(
    openai ? usage.prompt_tokens_details : usage.input_tokens_details,
  );
  const creationDetails = object(usage.cache_creation);
  const read = details.cached_tokens ?? usage.cache_read_input_tokens ?? 0;
  const creation5m =
    usage.claude_cache_creation_5_m_tokens ??
    creationDetails.ephemeral_5m_input_tokens ??
    0;
  const creation1h =
    usage.claude_cache_creation_1_h_tokens ??
    creationDetails.ephemeral_1h_input_tokens ??
    0;
  if (![input, output, read, creation5m, creation1h].every(validCount))
    return {
      availability: "unknown",
      reason: "missing_or_invalid_token_counts",
    };
  const creationAliases = [
    usage.cache_creation_input_tokens,
    details.cached_creation_tokens,
    details.cache_write_tokens,
    details.cache_creation_tokens,
  ].filter((value) => value !== undefined);
  const creation =
    creationAliases[0] ?? Number(creation5m) + Number(creation1h);
  if (
    !validCount(creation) ||
    creationAliases.some((value) => !validCount(value) || value !== creation) ||
    (Number(creation5m) + Number(creation1h) > 0 &&
      creation !== Number(creation5m) + Number(creation1h))
  )
    return { availability: "unknown", reason: "invalid_cache_creation_counts" };
  // Anthropic native input excludes its top-level cache counters; OpenAI totals include them.
  const nativeSeparateCache =
    !openai &&
    details.cached_tokens === undefined &&
    (usage.cache_read_input_tokens !== undefined ||
      usage.cache_creation_input_tokens !== undefined ||
      usage.claude_cache_creation_5_m_tokens !== undefined ||
      usage.claude_cache_creation_1_h_tokens !== undefined ||
      usage.cache_creation !== undefined);
  const total =
    Number(input) + (nativeSeparateCache ? Number(read) + creation : 0);
  const uncached = total - Number(read) - creation;
  if (!validCount(total) || !validCount(uncached))
    return { availability: "unknown", reason: "cache_counts_exceed_input" };
  return {
    availability: "reported",
    tokens: {
      inputTokens: total,
      outputTokens: Number(output),
      uncachedInputTokens: uncached,
      cacheReadTokens: Number(read),
      cacheCreationTokens: creation,
      cacheCreation5mTokens: Number(creation5m),
      cacheCreation1hTokens: Number(creation1h),
    },
  };
}

export function aggregateChatUsage(
  segments: Array<Record<string, unknown> | null>,
): Record<string, unknown> | null {
  if (segments.every((segment) => segment === null)) return null;
  if (segments.length === 1) return segments[0];
  const usage = { ...object(segments.at(-1)), usage_segments: segments };
  const normalized = normalizeChatTokenUsage(usage);
  if (normalized.availability === "unknown")
    return { ...usage, usage_availability: "unknown" };
  const tokens = normalized.tokens;
  return {
    ...usage,
    usage_availability: "reported",
    prompt_tokens: tokens.inputTokens,
    completion_tokens: tokens.outputTokens,
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    prompt_tokens_details: {
      cached_tokens: tokens.cacheReadTokens,
      cached_creation_tokens: tokens.cacheCreationTokens,
      cache_write_tokens: tokens.cacheCreationTokens,
    },
    claude_cache_creation_5_m_tokens: tokens.cacheCreation5mTokens,
    claude_cache_creation_1_h_tokens: tokens.cacheCreation1hTokens,
  };
}

export function chatTokenCost(
  tokens: ChatTokenUsage,
  pricing: ChatTokenPricing,
): number {
  return new Prisma.Decimal(tokens.uncachedInputTokens)
    .times(pricing.input)
    .plus(new Prisma.Decimal(tokens.outputTokens).times(pricing.output))
    .plus(new Prisma.Decimal(tokens.cacheReadTokens).times(pricing.cacheRead))
    .plus(
      new Prisma.Decimal(tokens.cacheCreationTokens).times(
        pricing.cacheCreation,
      ),
    )
    .div(1_000_000)
    .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function chatTokenReserve(snapshot: ChatTokenPricingSnapshot): number {
  return new Prisma.Decimal(snapshot.maxInputTokens)
    .times(
      Math.max(
        snapshot.pricing.input,
        snapshot.pricing.cacheRead,
        snapshot.pricing.cacheCreation,
      ),
    )
    .plus(
      new Prisma.Decimal(snapshot.maxOutputTokens).times(
        snapshot.pricing.output,
      ),
    )
    .div(1_000_000)
    .toDecimalPlaces(6, Prisma.Decimal.ROUND_CEIL)
    .toNumber();
}

/** A byte per text token plus message overhead; never count base64 as text. */
export function chatInputTokenUpperBound(body: unknown): number {
  const count = (value: unknown): number => {
    if (typeof value === "string") return Buffer.byteLength(value, "utf8");
    if (Array.isArray(value))
      return value.reduce((sum, item) => sum + count(item), 0);
    if (!value || typeof value !== "object") return 0;
    const part = object(value);
    if (part.type === "image_url" || part.type === "input_image")
      return OPUS_IMAGE_TOKEN_BOUND;
    return (
      64 +
      Object.values(part).reduce<number>((sum, item) => sum + count(item), 0)
    );
  };
  return 1024 + count(body);
}

export function chatModelCallUsage(value: unknown): unknown {
  const normalized = normalizeChatTokenUsage(value);
  return normalized.availability === "reported"
    ? {
        ...object(value),
        input_tokens: normalized.tokens.inputTokens,
        output_tokens: normalized.tokens.outputTokens,
        uncached_input_tokens: normalized.tokens.uncachedInputTokens,
        cache_read_input_tokens: normalized.tokens.cacheReadTokens,
        cache_creation_input_tokens: normalized.tokens.cacheCreationTokens,
        input_tokens_details: {
          ...object(
            object(value).input_tokens_details ??
              object(value).prompt_tokens_details,
          ),
          cached_tokens: normalized.tokens.cacheReadTokens,
          cache_write_tokens: normalized.tokens.cacheCreationTokens,
          cached_creation_tokens: normalized.tokens.cacheCreationTokens,
        },
      }
    : {};
}
