import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  LUNA_MODEL_ID,
  type LunaConfigUpdate,
  type LunaStatus,
} from "@/lib/chat-model-options";

// Keep encrypted credentials outside the public/general system-config key list.
const KEYS = {
  enabled: "conversation.luna.enabled",
  baseUrl: "conversation.luna.baseUrl",
  apiKeyEnc: "conversation.luna.apiKeyEnc",
  credits: "conversation.luna.credits",
} as const;

export async function getLunaConfig() {
  const records = process.env.DATABASE_URL
    ? await db.systemConfig.findMany({
        where: { key: { in: Object.values(KEYS) } },
      })
    : [];
  const values = Object.fromEntries(records.map((row) => [row.key, row.value]));
  let apiKey: string | null = null;
  const encrypted = values[KEYS.apiKeyEnc];
  if (typeof encrypted === "string" && encrypted) {
    try {
      apiKey = decrypt(encrypted);
    } catch {
      logger.warn("Failed to decrypt Luna API key.");
    }
  }
  const credits = values[KEYS.credits];
  const baseUrl = values[KEYS.baseUrl];
  return {
    enabled: values[KEYS.enabled] === true,
    apiKey,
    baseUrl:
      typeof baseUrl === "string" && baseUrl ? baseUrl : "https://ai.ldai.us",
    model: LUNA_MODEL_ID,
    credits:
      typeof credits === "number" && Number.isFinite(credits) && credits >= 0
        ? credits
        : 0.2,
  };
}

export async function getLunaStatus(): Promise<LunaStatus> {
  const { apiKey, ...config } = await getLunaConfig();
  return { ...config, hasKey: Boolean(apiKey) };
}

export async function setLunaConfig(update: LunaConfigUpdate): Promise<void> {
  const entries: [string, string | number | boolean][] = [];
  if (update.enabled !== undefined)
    entries.push([KEYS.enabled, update.enabled]);
  if (update.baseUrl !== undefined)
    entries.push([KEYS.baseUrl, update.baseUrl.trim().replace(/\/+$/, "")]);
  if (update.credits !== undefined)
    entries.push([KEYS.credits, update.credits]);
  if (update.apiKey !== undefined) {
    const key = update.apiKey.trim();
    entries.push([KEYS.apiKeyEnc, key ? encrypt(key) : ""]);
  }
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
