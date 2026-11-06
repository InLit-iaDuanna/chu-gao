import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  SOL_MODEL_ID,
  type LunaConfigUpdate,
  type LunaStatus,
} from "@/lib/chat-model-options";

const KEYS = {
  enabled: "conversation.sol.enabled",
  baseUrl: "conversation.sol.baseUrl",
  apiKeyEnc: "conversation.sol.apiKeyEnc",
  credits: "conversation.sol.credits",
} as const;

export async function getSolConfig() {
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
  const price = values[KEYS.credits];
  const url = values[KEYS.baseUrl];
  return {
    enabled: values[KEYS.enabled] === true,
    model: SOL_MODEL_ID,
    baseUrl: typeof url === "string" && url ? url : "https://ai.ldai.us",
    apiKey,
    credits:
      typeof price === "number" && Number.isFinite(price) && price >= 0
        ? price
        : 0.2,
  };
}

export async function getSolStatus(): Promise<LunaStatus> {
  const { apiKey, ...config } = await getSolConfig();
  return { ...config, hasKey: Boolean(apiKey) };
}

export async function setSolConfig(update: LunaConfigUpdate) {
  const entries: Array<[string, string | number | boolean]> = [];
  if (update.enabled !== undefined)
    entries.push([KEYS.enabled, update.enabled]);
  if (update.baseUrl !== undefined)
    entries.push([KEYS.baseUrl, update.baseUrl.trim().replace(/\/+$/, "")]);
  if (update.credits !== undefined)
    entries.push([KEYS.credits, update.credits]);
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
