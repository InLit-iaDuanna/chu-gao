import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  OPUS_MODEL_ID,
  type ChatTokenPricing,
  type OpusStatus,
} from "@/lib/chat-model-options";

export { OPUS_MODEL_ID } from "@/lib/chat-model-options";

// These keys deliberately stay outside the public system-config allowlist.
export const OPUS_CONFIG_KEYS = {
  enabled: "conversation.opus.enabled",
  baseUrl: "conversation.opus.baseUrl",
  apiKeyEnc: "conversation.opus.apiKeyEnc",
  input: "conversation.opus.inputPerMillion",
  output: "conversation.opus.outputPerMillion",
  cacheRead: "conversation.opus.cacheReadPerMillion",
  cacheCreation: "conversation.opus.cacheCreationPerMillion",
} as const;

export const OPUS_DEFAULT_PRICING: Readonly<ChatTokenPricing> = Object.freeze({
  type: "per_million_tokens",
  input: 100,
  output: 500,
  cacheRead: 5,
  cacheCreation: 60,
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
export const opusConfigUpdateSchema = z
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

export async function getOpusConfig() {
  const records = process.env.DATABASE_URL
    ? await db.systemConfig.findMany({
        where: { key: { in: Object.values(OPUS_CONFIG_KEYS) } },
      })
    : [];
  const values = Object.fromEntries(records.map((row) => [row.key, row.value]));
  let apiKey: string | null = null;
  const encrypted = values[OPUS_CONFIG_KEYS.apiKeyEnc];
  if (typeof encrypted === "string" && encrypted) {
    try {
      apiKey = decrypt(encrypted);
    } catch {
      /* Unreadable credentials stay unavailable. */
    }
  }
  const pricing = { ...OPUS_DEFAULT_PRICING };
  for (const key of [
    "input",
    "output",
    "cacheRead",
    "cacheCreation",
  ] as const) {
    const parsed = rate.safeParse(values[OPUS_CONFIG_KEYS[key]]);
    if (parsed.success) pricing[key] = parsed.data;
  }
  const url = baseUrl.safeParse(values[OPUS_CONFIG_KEYS.baseUrl]);
  return {
    enabled: values[OPUS_CONFIG_KEYS.enabled] === true,
    model: OPUS_MODEL_ID,
    baseUrl: url.success ? url.data.replace(/\/+$/, "") : "https://botcf.com",
    apiKey,
    pricing,
  };
}

export async function getOpusStatus(): Promise<OpusStatus> {
  const { apiKey, ...config } = await getOpusConfig();
  return { ...config, hasKey: Boolean(apiKey) };
}

export async function setOpusConfig(
  input: z.infer<typeof opusConfigUpdateSchema>,
) {
  const update = opusConfigUpdateSchema.parse(input);
  const entries: Array<[string, string | number | boolean]> = [];
  if (update.enabled !== undefined)
    entries.push([OPUS_CONFIG_KEYS.enabled, update.enabled]);
  if (update.baseUrl !== undefined)
    entries.push([
      OPUS_CONFIG_KEYS.baseUrl,
      update.baseUrl.replace(/\/+$/, ""),
    ]);
  if (update.apiKey !== undefined) {
    const key = update.apiKey.trim();
    entries.push([OPUS_CONFIG_KEYS.apiKeyEnc, key ? encrypt(key) : ""]);
  }
  for (const [key, value] of Object.entries(update.pricing ?? {}))
    entries.push([
      OPUS_CONFIG_KEYS[key as keyof NonNullable<typeof update.pricing>],
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
