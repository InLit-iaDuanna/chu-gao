import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  opus: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { systemConfig: { findMany: mocks.read, upsert: vi.fn() } },
}));
vi.mock("@/lib/crypto", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: () => "synthetic-key",
}));
vi.mock("@/lib/opus-config", () => ({ getOpusConfig: mocks.opus }));

import {
  ASTRA_MODEL_ID,
  CHAT_MODEL_MULTIPLIERS,
  LEGACY_SOL_MODEL_ID,
  SOL_MODEL_ID,
  chatPriceMultiplier,
  isTokenPricedChatModel,
  scaleChatPricing,
  type ChatTokenPricing,
} from "./chat-model-options";
import { getAstraStatus, getSolStatus } from "./sol-config";

// The production Opus 5.5 rate card; everything else is a multiple of it.
const BASE: ChatTokenPricing = {
  type: "per_million_tokens",
  input: 100,
  output: 500,
  cacheRead: 5,
  cacheCreation: 60,
};

describe("price multipliers", () => {
  it("scales every rate and keeps six decimals", () => {
    expect(scaleChatPricing(BASE, 0.8)).toEqual({
      type: "per_million_tokens",
      input: 80,
      output: 400,
      cacheRead: 4,
      cacheCreation: 48,
    });
    expect(scaleChatPricing(BASE, 4)).toEqual({
      type: "per_million_tokens",
      input: 400,
      output: 2000,
      cacheRead: 20,
      cacheCreation: 240,
    });
    expect(scaleChatPricing({ ...BASE, input: 3 }, 0.8).input).toBe(2.4);
  });

  it("reads a multiplier back off an undeclared rate card", () => {
    expect(chatPriceMultiplier(BASE, BASE)).toBe(1);
    expect(chatPriceMultiplier(scaleChatPricing(BASE, 0.8), BASE)).toBe(0.8);
    expect(chatPriceMultiplier(scaleChatPricing(BASE, 2.8), BASE)).toBe(2.8);
    expect(chatPriceMultiplier(undefined, BASE)).toBeUndefined();
  });

  it("declares both GPT tiers and treats every GPT id as token priced", () => {
    expect(CHAT_MODEL_MULTIPLIERS[SOL_MODEL_ID]).toBe(0.8);
    expect(CHAT_MODEL_MULTIPLIERS[ASTRA_MODEL_ID]).toBe(4);
    for (const id of [SOL_MODEL_ID, ASTRA_MODEL_ID, LEGACY_SOL_MODEL_ID])
      expect(isTokenPricedChatModel(id)).toBe(true);
  });
});

describe("Sol and Astra configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/test");
    mocks.opus.mockResolvedValue({ pricing: BASE });
    mocks.read.mockResolvedValue([
      { key: "conversation.sol.enabled", value: true },
      { key: "conversation.sol.baseUrl", value: "https://gateway.invalid" },
      { key: "conversation.sol.apiKeyEnc", value: "encrypted-fixture" },
      { key: "conversation.astra.enabled", value: true },
    ]);
  });

  it("prices both tiers off the Opus card and shares one channel", async () => {
    expect(await getSolStatus()).toMatchObject({
      enabled: true,
      model: SOL_MODEL_ID,
      baseUrl: "https://gateway.invalid",
      hasKey: true,
      multiplier: 0.8,
      pricing: scaleChatPricing(BASE, 0.8),
    });
    const astra = await getAstraStatus();
    expect(astra).toMatchObject({
      enabled: true,
      model: ASTRA_MODEL_ID,
      baseUrl: "https://gateway.invalid",
      hasKey: true,
      multiplier: 4,
      pricing: scaleChatPricing(BASE, 4),
    });
    // The key never leaves the server.
    expect(astra).not.toHaveProperty("apiKey");
  });

  it("follows the Opus card when the base price changes", async () => {
    mocks.opus.mockResolvedValue({ pricing: { ...BASE, output: 1000 } });
    expect((await getAstraStatus()).pricing.output).toBe(4000);
  });

  it("keeps Astra off until its own switch is set", async () => {
    mocks.read.mockResolvedValue([
      { key: "conversation.sol.enabled", value: true },
      { key: "conversation.sol.apiKeyEnc", value: "encrypted-fixture" },
    ]);
    expect((await getAstraStatus()).enabled).toBe(false);
    expect((await getSolStatus()).enabled).toBe(true);
  });
});
