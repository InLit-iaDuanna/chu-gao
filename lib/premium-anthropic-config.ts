import { z } from "zod";

import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  FABLE_MODEL_ID,
  PREMIUM_ANTHROPIC_MODEL_IDS,
  PREMIUM_OPUS_MODEL_ID,
  type ChatTokenPricing,
  type PremiumAnthropicStatus,
} from "@/lib/chat-model-options";

// This is a second Anthropic-compatible route. The existing Opus config stays
// independent so its lower-cost botcf route remains available.
export const PREMIUM_ANTHROPIC_CONFIG_KEYS = {
  enabled: "conversation.anthropicPremium.enabled",
  baseUrl: "conversation.anthropicPremium.baseUrl",
  apiKeyEnc: "conversation.anthropicPremium.apiKeyEnc",
  input: "conversation.anthropicPremium.inputPerMillion",
  output: "conversation.anthropicPremium.outputPerMillion",
  cacheRead: "conversation.anthropicPremium.cacheReadPerMillion",
  cacheCreation: "conversation.anthropicPremium.cacheCreationPerMillion",
} as const;

export const PREMIUM_ANTHROPIC_DEFAULT_PRICING: Readonly<ChatTokenPricing> =
  Object.freeze({
    type: "per_million_tokens",
    input: 1_000,
    output: 2_000,
    cacheRead: 500,
    cacheCreation: 500,
  });

const rate = z
  .number()
  .min(0)
  .max(1_000_000)
  .refine((value) => value === Number(value.toFixed(6)));
const baseUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    /^https?:$/.test(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
});

export const premiumAnthropicConfigUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    baseUrl: baseUrl.optional(),
    apiKey: z.string().max(400).optional(),
    pricing: z
      .object({
        input: rate.optional(),
        output: rate.optional(),
        cacheRead: rate.optional(),
        cacheCreation: rate.optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

type Values = Record<string, unknown>;

async function loadValues(): Promise<Values> {
  const rows = process.env.DATABASE_URL
    ? await db.systemConfig.findMany({
        where: { key: { in: Object.values(PREMIUM_ANTHROPIC_CONFIG_KEYS) } },
      })
    : [];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function pricingFrom(values: Values): ChatTokenPricing {
  const pricing = { ...PREMIUM_ANTHROPIC_DEFAULT_PRICING };
  for (const key of [
    "input",
    "output",
    "cacheRead",
    "cacheCreation",
  ] as const) {
    const parsed = rate.safeParse(values[PREMIUM_ANTHROPIC_CONFIG_KEYS[key]]);
    if (parsed.success) pricing[key] = parsed.data;
  }
  return pricing;
}

function baseUrlFrom(values: Values): string {
  const parsed = baseUrl.safeParse(
    values[PREMIUM_ANTHROPIC_CONFIG_KEYS.baseUrl],
  );
  return parsed.success
    ? parsed.data.replace(/\/+$/, "")
    : "https://ai.ldai.us";
}

function apiKeyFrom(values: Values): string | null {
  const encrypted = values[PREMIUM_ANTHROPIC_CONFIG_KEYS.apiKeyEnc];
  if (typeof encrypted !== "string" || !encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

function fablePricing(pricing: ChatTokenPricing): ChatTokenPricing {
  return {
    ...pricing,
    input: pricing.input * 2,
    output: pricing.output * 2,
    cacheRead: pricing.cacheRead * 2,
    cacheCreation: pricing.cacheCreation * 2,
  };
}

export async function getPremiumAnthropicConfig(modelId: string) {
  const values = await loadValues();
  const basePricing = pricingFrom(values);
  return {
    enabled: values[PREMIUM_ANTHROPIC_CONFIG_KEYS.enabled] === true,
    model: modelId === FABLE_MODEL_ID ? FABLE_MODEL_ID : "claude-opus-5-5",
    baseUrl: baseUrlFrom(values),
    apiKey: apiKeyFrom(values),
    pricing:
      modelId === FABLE_MODEL_ID ? fablePricing(basePricing) : basePricing,
  };
}

export async function getPremiumAnthropicStatus(): Promise<PremiumAnthropicStatus> {
  const values = await loadValues();
  return {
    enabled: values[PREMIUM_ANTHROPIC_CONFIG_KEYS.enabled] === true,
    baseUrl: baseUrlFrom(values),
    model: "claude-opus-5-5",
    models: [...PREMIUM_ANTHROPIC_MODEL_IDS],
    hasKey: Boolean(apiKeyFrom(values)),
    pricing: pricingFrom(values),
  };
}

export async function setPremiumAnthropicConfig(
  input: z.infer<typeof premiumAnthropicConfigUpdateSchema>,
) {
  const update = premiumAnthropicConfigUpdateSchema.parse(input);
  const entries: Array<[string, string | number | boolean]> = [];
  if (update.enabled !== undefined)
    entries.push([PREMIUM_ANTHROPIC_CONFIG_KEYS.enabled, update.enabled]);
  if (update.baseUrl !== undefined)
    entries.push([
      PREMIUM_ANTHROPIC_CONFIG_KEYS.baseUrl,
      update.baseUrl.replace(/\/+$/, ""),
    ]);
  if (update.apiKey !== undefined) {
    const key = update.apiKey.trim();
    entries.push([
      PREMIUM_ANTHROPIC_CONFIG_KEYS.apiKeyEnc,
      key ? encrypt(key) : "",
    ]);
  }
  for (const [key, value] of Object.entries(update.pricing ?? {}))
    entries.push([
      PREMIUM_ANTHROPIC_CONFIG_KEYS[
        key as keyof NonNullable<typeof update.pricing>
      ],
      value,
    ]);
  await db.$transaction(
    entries.map(([key, value]) =>
      db.systemConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    ),
  );
}

export { PREMIUM_OPUS_MODEL_ID };
