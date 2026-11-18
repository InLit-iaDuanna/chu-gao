import { z } from "zod";

import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  GEMINI_ARGON_MODEL_ID,
  GEMINI_MODEL_IDS,
  type ChatTokenPricing,
  type GeminiStatus,
} from "@/lib/chat-model-options";

export const GEMINI_CONFIG_KEYS = {
  enabled: "conversation.gemini.enabled",
  baseUrl: "conversation.gemini.baseUrl",
  apiKeyEnc: "conversation.gemini.apiKeyEnc",
  input: "conversation.gemini.inputPerMillion",
  output: "conversation.gemini.outputPerMillion",
  cacheRead: "conversation.gemini.cacheReadPerMillion",
  cacheCreation: "conversation.gemini.cacheCreationPerMillion",
} as const;

// 70% of the premium Opus route: 1000/2000/500/500.
export const GEMINI_DEFAULT_PRICING: Readonly<ChatTokenPricing> = Object.freeze(
  {
    type: "per_million_tokens",
    input: 700,
    output: 1_400,
    cacheRead: 350,
    cacheCreation: 350,
  },
);

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

export const geminiConfigUpdateSchema = z
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

async function loadValues() {
  const rows = process.env.DATABASE_URL
    ? await db.systemConfig.findMany({
        where: { key: { in: Object.values(GEMINI_CONFIG_KEYS) } },
      })
    : [];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function pricingFrom(values: Record<string, unknown>): ChatTokenPricing {
  const pricing = { ...GEMINI_DEFAULT_PRICING };
  for (const key of [
    "input",
    "output",
    "cacheRead",
    "cacheCreation",
  ] as const) {
    const parsed = rate.safeParse(values[GEMINI_CONFIG_KEYS[key]]);
    if (parsed.success) pricing[key] = parsed.data;
  }
  return pricing;
}

function baseUrlFrom(values: Record<string, unknown>): string {
  const parsed = baseUrl.safeParse(values[GEMINI_CONFIG_KEYS.baseUrl]);
  return parsed.success
    ? parsed.data.replace(/\/+$/, "")
    : "https://ai.ldai.us";
}

function apiKeyFrom(values: Record<string, unknown>): string | null {
  const encrypted = values[GEMINI_CONFIG_KEYS.apiKeyEnc];
  if (typeof encrypted !== "string" || !encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

export async function getGeminiConfig(modelId: string) {
  const values = await loadValues();
  return {
    enabled: values[GEMINI_CONFIG_KEYS.enabled] === true,
    model: modelId,
    baseUrl: baseUrlFrom(values),
    apiKey: apiKeyFrom(values),
    pricing: pricingFrom(values),
  };
}

export async function getGeminiStatus(): Promise<GeminiStatus> {
  const values = await loadValues();
  return {
    enabled: values[GEMINI_CONFIG_KEYS.enabled] === true,
    baseUrl: baseUrlFrom(values),
    model: GEMINI_ARGON_MODEL_ID,
    models: [...GEMINI_MODEL_IDS],
    hasKey: Boolean(apiKeyFrom(values)),
    pricing: pricingFrom(values),
  };
}

export async function setGeminiConfig(
  input: z.infer<typeof geminiConfigUpdateSchema>,
) {
  const update = geminiConfigUpdateSchema.parse(input);
  const entries: Array<[string, string | number | boolean]> = [];
  if (update.enabled !== undefined)
    entries.push([GEMINI_CONFIG_KEYS.enabled, update.enabled]);
  if (update.baseUrl !== undefined)
    entries.push([
      GEMINI_CONFIG_KEYS.baseUrl,
      update.baseUrl.replace(/\/+$/, ""),
    ]);
  if (update.apiKey !== undefined) {
    const key = update.apiKey.trim();
    entries.push([GEMINI_CONFIG_KEYS.apiKeyEnc, key ? encrypt(key) : ""]);
  }
  for (const [key, value] of Object.entries(update.pricing ?? {}))
    entries.push([
      GEMINI_CONFIG_KEYS[key as keyof NonNullable<typeof update.pricing>],
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
