import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const SYSTEM_CONFIG_DEFAULTS = {
  registration: {
    inviteOnly: true,
    defaultCredits: 100,
  },
  generation: {
    globalConcurrency: 20,
    defaultDailyLimit: 50,
  },
  moderation: {
    enabled: true,
    blockedKeywords: [] as string[],
  },
} as const;

export type SystemConfig = typeof SYSTEM_CONFIG_DEFAULTS;

export function getPublicConfig(): { inviteOnly: boolean; version: string } {
  return {
    inviteOnly: SYSTEM_CONFIG_DEFAULTS.registration.inviteOnly,
    version: "v3.1-mvp",
  };
}

export const SYSTEM_CONFIG_DEFAULT_ROWS = {
  "registration.inviteOnly": true,
  "registration.defaultCredits": 100,
  "generation.globalConcurrency": 20,
  "generation.defaultDailyLimit": 50,
  "moderation.enabled": true,
  "moderation.blockedKeywords": [] as string[],
} as const;

export type SystemConfigKey = keyof typeof SYSTEM_CONFIG_DEFAULT_ROWS;

let configCache: {
  expiresAt: number;
  values: Record<SystemConfigKey, unknown>;
} | null = null;

export class SystemConfigUnavailableError extends Error {
  constructor(message = "System config storage is unavailable.") {
    super(message);
    this.name = "SystemConfigUnavailableError";
  }
}

function getDefaultRows(): Record<SystemConfigKey, unknown> {
  return { ...SYSTEM_CONFIG_DEFAULT_ROWS };
}

function isConfigKey(value: string): value is SystemConfigKey {
  return value in SYSTEM_CONFIG_DEFAULT_ROWS;
}

async function loadConfigRows({
  strict = false,
}: { strict?: boolean } = {}): Promise<Record<SystemConfigKey, unknown>> {
  if (!strict && configCache && configCache.expiresAt > Date.now()) {
    return configCache.values;
  }

  const values = getDefaultRows();

  if (!process.env.DATABASE_URL) {
    if (strict) {
      throw new SystemConfigUnavailableError(
        "DATABASE_URL is required to read system config.",
      );
    }

    configCache = {
      expiresAt: Date.now() + 60_000,
      values,
    };
    return values;
  }

  try {
    const rows = await db.systemConfig.findMany();

    for (const row of rows) {
      if (isConfigKey(row.key)) {
        values[row.key] = row.value;
      }
    }
  } catch (error) {
    if (strict) {
      logger.error({ error }, "System config read failed.");
      throw new SystemConfigUnavailableError();
    }

    return values;
  }

  configCache = {
    expiresAt: Date.now() + 60_000,
    values,
  };

  return values;
}

export async function getSystemConfigValue<K extends SystemConfigKey>(
  key: K,
): Promise<(typeof SYSTEM_CONFIG_DEFAULT_ROWS)[K]> {
  const values = await loadConfigRows();
  return values[key] as (typeof SYSTEM_CONFIG_DEFAULT_ROWS)[K];
}

export async function getRequiredSystemConfigValue<K extends SystemConfigKey>(
  key: K,
): Promise<(typeof SYSTEM_CONFIG_DEFAULT_ROWS)[K]> {
  const values = await loadConfigRows({ strict: true });
  return values[key] as (typeof SYSTEM_CONFIG_DEFAULT_ROWS)[K];
}

export async function listSystemConfigEntries(): Promise<
  Array<{ key: SystemConfigKey; value: unknown }>
> {
  const values = await loadConfigRows();

  return Object.entries(values).map(([key, value]) => ({
    key: key as SystemConfigKey,
    value,
  }));
}

export async function listRequiredSystemConfigEntries(): Promise<
  Array<{ key: SystemConfigKey; value: unknown }>
> {
  const values = await loadConfigRows({ strict: true });

  return Object.entries(values).map(([key, value]) => ({
    key: key as SystemConfigKey,
    value,
  }));
}

export async function setSystemConfigValue(
  key: SystemConfigKey,
  value: unknown,
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    configCache = null;
    throw new SystemConfigUnavailableError(
      "DATABASE_URL is required to update system config.",
    );
  }

  const jsonValue = value as Prisma.InputJsonValue;

  await db.systemConfig.upsert({
    where: { key },
    create: { key, value: jsonValue },
    update: { value: jsonValue },
  });

  configCache = null;
}

export async function getPublicRuntimeConfig(): Promise<{
  inviteOnly: boolean;
  version: string;
}> {
  return {
    inviteOnly: await getRequiredSystemConfigValue("registration.inviteOnly"),
    version: "v3.1-mvp",
  };
}
