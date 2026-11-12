// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  chatInputTokenUpperBound,
  chatModelCallUsage,
  chatTokenCost,
  chatTokenReserve,
  aggregateChatUsage,
  normalizeChatTokenUsage,
  OPUS_IMAGE_TOKEN_BOUND,
  readChatTokenPricingSnapshot,
  type ChatTokenPricingSnapshot,
} from "./chat-token-billing";

const pricing = {
  type: "per_million_tokens" as const,
  input: 100,
  output: 500,
  cacheRead: 5,
  cacheCreation: 60,
};
export const probeUsage = {
  prompt_tokens: 270,
  completion_tokens: 1,
  total_tokens: 271,
  prompt_tokens_details: {
    cached_tokens: 35,
    cached_creation_tokens: 227,
    cache_write_tokens: 227,
  },
  input_tokens: 270,
  output_tokens: 0,
  input_tokens_details: null,
  claude_cache_creation_5_m_tokens: 227,
  claude_cache_creation_1_h_tokens: 0,
};

describe("per-million chat token billing", () => {
  it("bills the verified gateway sample once per cache category and prefers completion_tokens", () => {
    const result = normalizeChatTokenUsage(probeUsage);
    expect(result).toEqual({
      availability: "reported",
      tokens: {
        inputTokens: 270,
        outputTokens: 1,
        uncachedInputTokens: 8,
        cacheReadTokens: 35,
        cacheCreationTokens: 227,
        cacheCreation5mTokens: 227,
        cacheCreation1hTokens: 0,
      },
    });
    if (result.availability !== "reported")
      throw new Error("Expected reported usage");
    expect(chatTokenCost(result.tokens, pricing)).toBe(0.015095);
    expect(chatModelCallUsage(probeUsage)).toMatchObject({
      input_tokens: 270,
      output_tokens: 1,
    });
  });

  it("handles the first probe with a cached read and no creation", () => {
    const result = normalizeChatTokenUsage({
      prompt_tokens: 71,
      completion_tokens: 1,
      input_tokens: 71,
      output_tokens: 0,
      prompt_tokens_details: { cached_tokens: 63 },
      claude_cache_creation_5_m_tokens: 0,
      claude_cache_creation_1_h_tokens: 0,
    });
    expect(result).toMatchObject({
      tokens: { uncachedInputTokens: 8, cacheReadTokens: 63, outputTokens: 1 },
    });
    if (result.availability !== "reported")
      throw new Error("Expected reported usage");
    expect(chatTokenCost(result.tokens, pricing)).toBe(0.001615);
  });

  it("supports Anthropic separate input counters and both creation TTLs without alias duplication", () => {
    const result = normalizeChatTokenUsage({
      input_tokens: 8,
      output_tokens: 1,
      cache_read_input_tokens: 35,
      cache_creation_input_tokens: 227,
      cache_creation: {
        ephemeral_5m_input_tokens: 200,
        ephemeral_1h_input_tokens: 27,
      },
      claude_cache_creation_5_m_tokens: 200,
      claude_cache_creation_1_h_tokens: 27,
    });
    expect(result).toMatchObject({
      availability: "reported",
      tokens: {
        inputTokens: 270,
        uncachedInputTokens: 8,
        cacheCreationTokens: 227,
        cacheCreation5mTokens: 200,
        cacheCreation1hTokens: 27,
      },
    });
  });

  it.each([
    null,
    {},
    { prompt_tokens: 1 },
    { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: 0.1 },
    {
      prompt_tokens: 10,
      completion_tokens: 1,
      prompt_tokens_details: { cached_tokens: 11 },
    },
    { ...probeUsage, claude_cache_creation_5_m_tokens: 228 },
    {
      ...probeUsage,
      prompt_tokens_details: {
        cached_tokens: 35,
        cached_creation_tokens: 227,
        cache_write_tokens: 228,
      },
    },
  ])("marks incomplete or inconsistent usage as unknown: %j", (usage) => {
    expect(normalizeChatTokenUsage(usage).availability).toBe("unknown");
    expect(chatModelCallUsage(usage)).toEqual({});
  });

  it("accepts true zero usage and sums all categories before six-decimal rounding", () => {
    const result = normalizeChatTokenUsage({
      prompt_tokens: 0,
      completion_tokens: 0,
    });
    expect(result.availability).toBe("reported");
    if (result.availability !== "reported")
      throw new Error("Expected reported usage");
    expect(chatTokenCost(result.tokens, pricing)).toBe(0);
    expect(
      chatTokenCost(
        { ...result.tokens, cacheReadTokens: 1 },
        { ...pricing, cacheRead: 0.5 },
      ),
    ).toBe(0.000001);
  });

  it("reserves the worst input rate and output bound using frozen values", () => {
    const snapshot: ChatTokenPricingSnapshot = {
      version: 1,
      pricing: { ...pricing, cacheCreation: 120 },
      maxInputTokens: 270,
      maxOutputTokens: 64,
    };
    const frozen = readChatTokenPricingSnapshot(snapshot)!;
    snapshot.pricing.output = 999;
    expect(chatTokenReserve(frozen)).toBe(0.0644);
    expect(() =>
      readChatTokenPricingSnapshot({ ...frozen, maxInputTokens: NaN }),
    ).toThrow();
    expect(() =>
      readChatTokenPricingSnapshot({ ...frozen, version: 2 }),
    ).toThrow();
  });

  it("bounds text in bytes and images conservatively without charging base64 text", () => {
    const makeBody = (url: string) => ({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    });
    const small = chatInputTokenUpperBound(
      makeBody("data:image/jpeg;base64,a"),
    );
    expect(
      chatInputTokenUpperBound(
        makeBody("data:image/jpeg;base64," + "a".repeat(1_000_000)),
      ),
    ).toBe(small);
    expect(small).toBeGreaterThan(OPUS_IMAGE_TOKEN_BOUND);
    expect(chatInputTokenUpperBound({ messages: [] })).toBeLessThan(2_000);
  });

  it("keeps absent usage empty across recovery requests", () => {
    expect(aggregateChatUsage([null, null, null])).toBeNull();
  });

  it("sums each recovery request once and keeps every raw segment", () => {
    const usage = aggregateChatUsage([probeUsage, probeUsage]);
    const result = normalizeChatTokenUsage(usage);
    expect(result).toMatchObject({
      availability: "reported",
      tokens: {
        inputTokens: 540,
        outputTokens: 2,
        uncachedInputTokens: 16,
        cacheReadTokens: 70,
        cacheCreationTokens: 454,
      },
    });
    if (result.availability !== "reported")
      throw new Error("Expected reported usage");
    expect(chatTokenCost(result.tokens, pricing)).toBe(0.03019);
    expect(usage!.usage_segments).toEqual([probeUsage, probeUsage]);
  });

  it("does not charge only the final segment when a previous recovery request lacks usage", () => {
    const usage = aggregateChatUsage([null, probeUsage]);
    expect(usage).toMatchObject({ usage_availability: "unknown" });
    expect(normalizeChatTokenUsage(usage)).toEqual({
      availability: "unknown",
      reason: "recovery_segment_usage_unknown",
    });
  });
});
