import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  ASTRA_MODEL_ID,
  CHAT_MODEL_MULTIPLIERS,
  SOL_MODEL_ID,
  scaleChatPricing,
  type ChatTokenPricing,
  type GptStatus,
  type LunaConfigUpdate,
  type LunaStatus,
} from "@/lib/chat-model-options";
import { getOpusConfig } from "@/lib/opus-config";

/**
 * Sol and Astra are one channel: a shared gateway, key and rate card, each with
 * its own on/off switch. Keys stay under the historical `conversation.sol.*`
 * names so existing installs keep their credentials.
 */
const KEYS = {
  enabled: "conversation.sol.enabled",
  baseUrl: "conversation.sol.baseUrl",
  apiKeyEnc: "conversation.sol.apiKeyEnc",
  credits: "conversation.sol.credits",
  astraEnabled: "conversation.astra.enabled",
} as const;

async function readChannel() {
  const rows = process.env.DATABASE_URL
    ? await db.systemConfig.findMany({
        where: { key: { in: Object.values(KEYS) } },
      })
    : [];
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  let apiKey: string | null = null;
  const encrypted = values[KEYS.apiKeyEnc];
  if (typeof encrypted === "string" && encrypted) {
    try {
      apiKey = decrypt(encrypted);
    } catch {
      /* Invalid credentials stay unavailable. */
    }
  }
  const url = values[KEYS.baseUrl];
  return {
    values,
    apiKey,
    baseUrl:
      typeof url === "string" && url ? url : "https://ai.ldai.us",
  };
}

/** Rate card of a model priced off the Opus 5.5 base. */
async function basePricing(): Promise<ChatTokenPricing> {
  return (await getOpusConfig()).pricing;
}

export async function getSolConfig() {
  const [channel, pricing] = await Promise.all([readChannel(), basePricing()]);
  const price = channel.values[KEYS.credits];
  return {
    enabled: channel.values[KEYS.enabled] === true,
    model: SOL_MODEL_ID,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    multiplier: CHAT_MODEL_MULTIPLIERS[SOL_MODEL_ID] ?? 1,
    pricing: scaleChatPricing(pricing, CHAT_MODEL_MULTIPLIERS[SOL_MODEL_ID] ?? 1),
    /** Retired per-turn price, kept only so old admin payloads still parse. */
    credits:
      typeof price === "number" && Number.isFinite(price) && price >= 0
        ? price
        : 0.2,
  };
}

export async function getAstraConfig() {
  const [channel, pricing] = await Promise.all([readChannel(), basePricing()]);
  const multiplier = CHAT_MODEL_MULTIPLIERS[ASTRA_MODEL_ID] ?? 1;
  return {
    enabled: channel.values[KEYS.astraEnabled] === true,
    model: ASTRA_MODEL_ID,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    multiplier,
    pricing: scaleChatPricing(pricing, multiplier),
  };
}

export async function getSolStatus(): Promise<GptStatus> {
  const { apiKey, model, baseUrl, enabled, multiplier, pricing } =
    await getSolConfig();
  return {
    enabled,
    model,
    baseUrl,
    multiplier,
    pricing,
    hasKey: Boolean(apiKey),
  };
}

export async function getAstraStatus(): Promise<GptStatus> {
  const { apiKey, ...config } = await getAstraConfig();
  return { ...config, hasKey: Boolean(apiKey) };
}

export async function setSolConfig(
  update: Omit<LunaConfigUpdate, "credits"> & { credits?: number },
) {
  const entries: Array<[string, string | number | boolean]> = [];
  if (update.enabled !== undefined)
    entries.push([KEYS.enabled, update.enabled]);
  if (update.baseUrl !== undefined)
    entries.push([KEYS.baseUrl, update.baseUrl.trim().replace(/\/+$/, "")]);
  // The per-turn price is no longer charged; ignore it if an old form sends one.
  if (update.apiKey !== undefined)
    entries.push([
      KEYS.apiKeyEnc,
      update.apiKey.trim() ? encrypt(update.apiKey.trim()) : "",
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

export async function setAstraConfig(update: { enabled?: boolean }) {
  if (update.enabled === undefined) return;
  await db.systemConfig.upsert({
    where: { key: KEYS.astraEnabled },
    create: { key: KEYS.astraEnabled, value: update.enabled },
    update: { value: update.enabled },
  });
}

/** Legacy Luna entry point kept for the hidden 5.6 route. */
export type { LunaStatus };
