import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { OPUS_CONFIG_KEYS, OPUS_DEFAULT_PRICING } from "@/lib/opus-config";
import { OPUS_MODEL_ID } from "@/lib/chat-model-options";
import {
  CHAT_RUNTIME_CONFIG_KEY,
  getChatRuntimeConfig,
} from "@/lib/chat-runtime-config";
import { CHANNEL_REQUEST_CONFIG_KEY } from "@/lib/provider-channel-request-config";
import { normalizeProviderChannelBaseUrl } from "@/lib/provider-channels";
import { FALLBACK_PROVIDER_ID } from "@/lib/providers/account-pool";

const apply = process.argv.includes("--apply");
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

async function main() {
  const reader = createInterface({ input: process.stdin, terminal: false });
  const line = await new Promise<string>((resolve) =>
    reader.once("line", resolve),
  );
  reader.close();
  let credentials: { fallbackKey?: string; opusKey?: string };
  try {
    credentials = JSON.parse(line);
  } catch {
    throw new Error("INVALID_CREDENTIAL_INPUT");
  }
  const { fallbackKey, opusKey } = credentials;
  if (!fallbackKey?.startsWith("sk-") || !opusKey?.startsWith("sk-"))
    throw new Error("MISSING_CREDENTIAL_INPUT");
  const baseUrl = "https://ai.ldai.us";
  const accounts = await db.providerAccount.findMany({
    where: { providerId: { not: FALLBACK_PROVIDER_ID } },
    select: { id: true, baseUrl: true, apiKeyEnc: true, inFlight: true },
  });
  const duplicates = accounts.filter((account) => {
    if (normalizeProviderChannelBaseUrl(account.baseUrl) !== baseUrl)
      return false;
    try {
      return decrypt(account.apiKeyEnc) === fallbackKey;
    } catch {
      return false;
    }
  });
  if (duplicates.some((account) => account.inFlight > 0))
    throw new Error("FALLBACK_ACCOUNT_BUSY");
  const runtime = await getChatRuntimeConfig();
  const summary = {
    apply,
    fallbackProvider: FALLBACK_PROVIDER_ID,
    multiplier: 2,
    disableDuplicateAccountIds: duplicates.map((account) => account.id),
    gifBaseUrl: baseUrl,
    chatModel: OPUS_MODEL_ID,
    effort: ["low", "medium", "high", "xhigh", "max"],
    pricing: OPUS_DEFAULT_PRICING,
  };
  if (!apply) {
    console.log(JSON.stringify(summary));
    return;
  }
  await db.$transaction(async (tx) => {
    if (duplicates.length) {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ProviderAccount"
        WHERE "id" IN (${Prisma.join(duplicates.map((account) => account.id))})
        FOR UPDATE
      `);
      const busy = await tx.providerAccount.count({
        where: {
          id: { in: duplicates.map((account) => account.id) },
          inFlight: { gt: 0 },
        },
      });
      if (busy) throw new Error("FALLBACK_ACCOUNT_BUSY");
    }
    for (const [key, value] of [
      [CHAT_RUNTIME_CONFIG_KEY, runtime],
      [CHANNEL_REQUEST_CONFIG_KEY, {}],
    ] as const) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "SystemConfig" ("key", "value", "updatedAt")
        VALUES (${key}, ${JSON.stringify(value)}::jsonb, clock_timestamp())
        ON CONFLICT ("key") DO NOTHING
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "key" FROM "SystemConfig" WHERE "key" = ${key} FOR UPDATE
      `);
    }
    const encryptedFallback = encrypt(fallbackKey);
    const modelsSupported = [
      "gpt-image-2",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
      "gpt-image-2.6-flare",
      "gpt-image-2.6-sunburst",
    ];
    await tx.provider.upsert({
      where: { id: FALLBACK_PROVIDER_ID },
      create: {
        id: FALLBACK_PROVIDER_ID,
        name: "Chuago 保底",
        protocol: "OPENAI_IMAGES",
        baseUrl,
        apiKeyEnc: encryptedFallback,
        modelsSupported,
        priority: 0,
        costMultiplier: 2,
        poolMaxConcurrency: 1,
        note: "普通渠道失败后使用；按对应定价的倍率计费",
      },
      update: {
        baseUrl,
        apiKeyEnc: encryptedFallback,
        modelsSupported,
        costMultiplier: 2,
        isActive: true,
        health: "HEALTHY",
        consecutiveErrors: 0,
        lastErrorMsg: null,
      },
    });
    if (duplicates.length)
      await tx.providerAccount.updateMany({
        where: { id: { in: duplicates.map((account) => account.id) } },
        data: { isActive: false },
      });
    const fingerprint = createHash("sha256").update(fallbackKey).digest("hex");
    await tx.providerAccount.upsert({
      where: {
        providerId_baseUrl_apiKeyFingerprint: {
          providerId: FALLBACK_PROVIDER_ID,
          baseUrl,
          apiKeyFingerprint: fingerprint,
        },
      },
      create: {
        id: "ldai-fallback-default",
        providerId: FALLBACK_PROVIDER_ID,
        name: "4K 保底账号",
        baseUrl,
        apiKeyEnc: encryptedFallback,
        apiKeyFingerprint: fingerprint,
        maxConcurrency: 1,
      },
      update: {
        apiKeyEnc: encryptedFallback,
        isActive: true,
        health: "HEALTHY",
        cooldownUntil: null,
        consecutiveErrors: 0,
        lastErrorMsg: null,
      },
    });
    const entries: Array<[string, string | number | boolean]> = [
      [OPUS_CONFIG_KEYS.enabled, true],
      [OPUS_CONFIG_KEYS.baseUrl, "https://botcf.com"],
      [OPUS_CONFIG_KEYS.apiKeyEnc, encrypt(opusKey)],
      [OPUS_CONFIG_KEYS.input, 100],
      [OPUS_CONFIG_KEYS.output, 500],
      [OPUS_CONFIG_KEYS.cacheRead, 5],
      [OPUS_CONFIG_KEYS.cacheCreation, 60],
    ];
    for (const [key, value] of entries)
      await tx.systemConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    const runtimeRow = await tx.systemConfig.findUniqueOrThrow({
      where: { key: CHAT_RUNTIME_CONFIG_KEY },
    });
    const currentRuntime = object(runtimeRow.value);
    const profiles = Array.isArray(currentRuntime.profiles)
      ? currentRuntime.profiles.filter(
          (profile): profile is string => typeof profile === "string",
        )
      : runtime.profiles;
    const runtimeValue = {
      ...currentRuntime,
      profiles: [...new Set([...profiles, OPUS_MODEL_ID])],
    } as Prisma.InputJsonObject;
    await tx.systemConfig.upsert({
      where: { key: CHAT_RUNTIME_CONFIG_KEY },
      create: { key: CHAT_RUNTIME_CONFIG_KEY, value: runtimeValue },
      update: { value: runtimeValue },
    });
    const channelRow = await tx.systemConfig.findUnique({
      where: { key: CHANNEL_REQUEST_CONFIG_KEY },
    });
    const current = object(channelRow?.value);
    const channelValue = {
      ...current,
      [baseUrl]: {
        ...object(current[baseUrl]),
        supportsGif: true,
        responseFormat: "b64_json",
      },
    } as Prisma.InputJsonObject;
    await tx.systemConfig.upsert({
      where: { key: CHANNEL_REQUEST_CONFIG_KEY },
      create: { key: CHANNEL_REQUEST_CONFIG_KEY, value: channelValue },
      update: { value: channelValue },
    });
  });
  console.log(JSON.stringify(summary));
}

main()
  .catch((error: unknown) => {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "CONFIGURATION_FAILED";
    console.error(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
