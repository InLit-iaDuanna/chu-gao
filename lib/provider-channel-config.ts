import { db } from "@/lib/db";
import {
  IMAGE2_CHANNEL_DISPLAY_NAMES_CONFIG_KEY,
  PROVIDER_CHANNEL_DISPLAY_NAMES_CONFIG_KEY,
  providerChannelDisplayNameMapFromConfig,
  normalizeProviderChannelBaseUrl,
  type ProviderChannelDisplayNameMap,
  type Image2ChannelDisplayNameMap,
} from "@/lib/provider-channels";

function normalizeDisplayName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

export async function getProviderChannelDisplayNameMap(): Promise<ProviderChannelDisplayNameMap> {
  if (!process.env.DATABASE_URL) {
    return {};
  }

  const rows = await db.systemConfig.findMany({
    where: {
      key: {
        in: [
          IMAGE2_CHANNEL_DISPLAY_NAMES_CONFIG_KEY,
          PROVIDER_CHANNEL_DISPLAY_NAMES_CONFIG_KEY,
        ],
      },
    },
    select: { key: true, value: true },
  });
  const legacy = rows.find(
    (row) => row.key === IMAGE2_CHANNEL_DISPLAY_NAMES_CONFIG_KEY,
  );
  const current = rows.find(
    (row) => row.key === PROVIDER_CHANNEL_DISPLAY_NAMES_CONFIG_KEY,
  );

  return {
    ...providerChannelDisplayNameMapFromConfig(legacy?.value),
    ...providerChannelDisplayNameMapFromConfig(current?.value),
  };
}

export const getImage2ChannelDisplayNameMap =
  getProviderChannelDisplayNameMap;

export async function setProviderChannelDisplayName(
  baseUrl: string,
  displayName: string,
): Promise<ProviderChannelDisplayNameMap> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to update channel display names.");
  }

  const normalizedBaseUrl = normalizeProviderChannelBaseUrl(baseUrl);
  const normalizedDisplayName = normalizeDisplayName(displayName);

  if (!normalizedBaseUrl || !normalizedDisplayName) {
    throw new Error("Invalid channel display name.");
  }

  const current = await getProviderChannelDisplayNameMap();
  const next = {
    ...current,
    [normalizedBaseUrl]: normalizedDisplayName,
  };

  await db.systemConfig.upsert({
    where: { key: PROVIDER_CHANNEL_DISPLAY_NAMES_CONFIG_KEY },
    create: { key: PROVIDER_CHANNEL_DISPLAY_NAMES_CONFIG_KEY, value: next },
    update: { value: next },
  });

  return next;
}

export const setImage2ChannelDisplayName = setProviderChannelDisplayName;

export type { Image2ChannelDisplayNameMap };
