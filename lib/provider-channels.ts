import type { ProviderAccount, ProviderHealth } from "@prisma/client";

import type {
  Image2ProviderChannelId,
  ProviderChannelId,
  PublicProviderChannel,
} from "@/lib/models/types";

export type ProviderChannel = {
  id: ProviderChannelId;
  displayName: string;
  baseUrl: string;
  accountCount?: number;
  availableAccountCount?: number;
};

export type Image2ProviderChannel = ProviderChannel & {
  id: Image2ProviderChannelId;
};

const LEGACY_IMAGE2_CHANNELS = {
  aquatic: {
    id: "aquatic",
    displayName: "水生动物渠道",
    baseUrl: "https://lucen.cc",
  },
  terrestrial: {
    id: "terrestrial",
    displayName: "陆生动物渠道",
    baseUrl: "https://api.xpzhao.top",
  },
} satisfies Record<string, ProviderChannel>;

const GENERIC_PROVIDER_NAMES = new Set([
  "image2",
  "gpt-image-2",
  "sub2api",
  "openai-images",
  "openai image",
  "openai images",
]);

export const IMAGE2_CHANNEL_DISPLAY_NAMES_CONFIG_KEY =
  "image2.channelDisplayNames";
export const PROVIDER_CHANNEL_DISPLAY_NAMES_CONFIG_KEY =
  "provider.channelDisplayNames";

export type ProviderChannelDisplayNameMap = Record<string, string>;
export type Image2ChannelDisplayNameMap = ProviderChannelDisplayNameMap;

export const DEFAULT_IMAGE2_PROVIDER_CHANNEL_ID: Image2ProviderChannelId =
  channelIdFromBaseUrl(LEGACY_IMAGE2_CHANNELS.aquatic.baseUrl);

export const IMAGE2_PROVIDER_CHANNEL_OPTIONS = Object.values(
  LEGACY_IMAGE2_CHANNELS,
).map((channel) => ({
  ...channel,
  id: channelIdFromBaseUrl(channel.baseUrl),
}));

export function isImage2ProviderChannelId(
  value: unknown,
): value is Image2ProviderChannelId {
  return typeof value === "string" && value.trim().length > 0;
}

export function isImage2ModelId(modelId?: string | null): boolean {
  return modelId === "gpt-image-2";
}

export function supportsProviderChannels(modelId?: string | null): boolean {
  return (
    modelId === "gpt-image-2" ||
    modelId === "gemini-3.1-flash-image-preview" ||
    modelId === "gemini-3-pro-image-preview"
  );
}

export function normalizeProviderChannelBaseUrl(
  value?: string | null,
): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function channelIdFromBaseUrl(baseUrl: string): ProviderChannelId {
  const normalized = normalizeProviderChannelBaseUrl(baseUrl) ?? baseUrl.trim();

  return `url_${hashString(normalized)}`;
}

export function resolveImage2ProviderChannelBaseUrl(
  channelId?: string | null,
): string | null {
  if (!channelId) {
    return null;
  }

  const legacy = LEGACY_IMAGE2_CHANNELS[channelId as keyof typeof LEGACY_IMAGE2_CHANNELS];

  if (legacy) {
    return normalizeProviderChannelBaseUrl(legacy.baseUrl);
  }

  const matchedLegacyOption = IMAGE2_PROVIDER_CHANNEL_OPTIONS.find(
    (channel) => channel.id === channelId,
  );

  return normalizeProviderChannelBaseUrl(matchedLegacyOption?.baseUrl);
}

export function inferProviderChannelIdFromBaseUrl(
  baseUrl?: string | null,
): ProviderChannelId | null {
  const normalized = normalizeProviderChannelBaseUrl(baseUrl);

  if (!normalized) {
    return null;
  }

  return channelIdFromBaseUrl(normalized);
}

export const inferImage2ProviderChannelIdFromBaseUrl =
  inferProviderChannelIdFromBaseUrl;

function defaultDisplayNameForBaseUrl(baseUrl: string): string {
  const normalized = normalizeProviderChannelBaseUrl(baseUrl) ?? baseUrl;
  const legacy = Object.values(LEGACY_IMAGE2_CHANNELS).find(
    (channel) => normalizeProviderChannelBaseUrl(channel.baseUrl) === normalized,
  );

  if (legacy) {
    return legacy.displayName;
  }

  try {
    const host = new URL(normalized).hostname.replace(/^www\./, "");
    return `${host} 渠道`;
  } catch {
    return "自定义渠道";
  }
}

function validDisplayName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

export function providerChannelDisplayNameMapFromConfig(
  value: unknown,
): ProviderChannelDisplayNameMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([baseUrl, displayName]) => {
      const normalizedBaseUrl = normalizeProviderChannelBaseUrl(baseUrl);
      const normalizedDisplayName = validDisplayName(displayName);

      return normalizedBaseUrl && normalizedDisplayName
        ? ([normalizedBaseUrl, normalizedDisplayName] as const)
        : null;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  return Object.fromEntries(entries);
}

export const image2ChannelDisplayNameMapFromConfig =
  providerChannelDisplayNameMapFromConfig;

export function displayNameForProviderChannelWithMap(
  baseUrl?: string | null,
  fallbackName?: string | null,
  displayNameMap: ProviderChannelDisplayNameMap = {},
): string | null {
  const normalized = normalizeProviderChannelBaseUrl(baseUrl);
  const customDisplayName = normalized
    ? validDisplayName(displayNameMap[normalized])
    : null;

  return (
    customDisplayName ??
    displayNameForProviderChannel(normalized, fallbackName)
  );
}

export const displayNameForImage2ChannelWithMap =
  displayNameForProviderChannelWithMap;

export function displayNameForProviderChannel(
  baseUrl?: string | null,
  fallbackName?: string | null,
): string | null {
  const normalized = normalizeProviderChannelBaseUrl(baseUrl);

  if (!normalized) {
    return null;
  }

  const legacyName = Object.values(LEGACY_IMAGE2_CHANNELS).find(
    (channel) => normalizeProviderChannelBaseUrl(channel.baseUrl) === normalized,
  )?.displayName;

  const fallback = fallbackName?.trim();
  const isGenericFallback = fallback
    ? GENERIC_PROVIDER_NAMES.has(fallback.toLowerCase())
    : false;

  return legacyName ??
    (fallback && !isGenericFallback
      ? fallback
      : defaultDisplayNameForBaseUrl(normalized));
}

export const displayNameForImage2Channel = displayNameForProviderChannel;

function isAccountAvailable(account: {
  isActive: boolean;
  health: ProviderHealth;
  cooldownUntil?: Date | null;
}): boolean {
  return (
    account.isActive &&
    account.health !== "DOWN" &&
    (!account.cooldownUntil || account.cooldownUntil <= new Date())
  );
}

export function buildProviderChannelsFromAccounts<
  T extends Pick<ProviderAccount, "baseUrl" | "isActive" | "health" | "cooldownUntil"> & {
    provider?: { name?: string | null } | null;
  },
>(
  accounts: T[],
  options: {
    displayNameMap?: ProviderChannelDisplayNameMap;
  } = {},
): ProviderChannel[] {
  const groups = new Map<
    string,
    {
      baseUrl: string;
      providerName: string | null;
      accountCount: number;
      availableAccountCount: number;
    }
  >();

  for (const account of accounts) {
    const normalized = normalizeProviderChannelBaseUrl(account.baseUrl);

    if (!normalized) {
      continue;
    }

    const current =
      groups.get(normalized) ??
      {
        baseUrl: normalized,
        providerName: account.provider?.name ?? null,
        accountCount: 0,
        availableAccountCount: 0,
      };

    current.accountCount += 1;

    if (isAccountAvailable(account)) {
      current.availableAccountCount += 1;
    }

    if (!current.providerName && account.provider?.name) {
      current.providerName = account.provider.name;
    }

    groups.set(normalized, current);
  }

  const channels = Array.from(groups.values())
    .map((group) => ({
      id: channelIdFromBaseUrl(group.baseUrl),
      displayName: displayNameForProviderChannelWithMap(
        group.baseUrl,
        group.providerName,
        options.displayNameMap,
      ) as string,
      baseUrl: group.baseUrl,
      accountCount: group.accountCount,
      availableAccountCount: group.availableAccountCount,
    }))
    .sort((left, right) => {
      if (right.availableAccountCount !== left.availableAccountCount) {
        return right.availableAccountCount - left.availableAccountCount;
      }

      if (right.accountCount !== left.accountCount) {
        return right.accountCount - left.accountCount;
      }

      return left.displayName.localeCompare(right.displayName, "zh-CN");
    });

  return channels;
}

export const buildImage2ProviderChannelsFromAccounts =
  buildProviderChannelsFromAccounts;

export function toPublicProviderChannels(
  channels: ProviderChannel[],
): PublicProviderChannel[] {
  return channels.map((channel) => ({
    id: channel.id,
    displayName: channel.displayName,
    accountCount: channel.accountCount ?? 0,
    availableAccountCount: channel.availableAccountCount ?? 0,
  }));
}

type ProviderChannelChoice = Pick<
  ProviderChannel,
  "id" | "displayName"
> &
  Partial<
    Pick<ProviderChannel, "baseUrl" | "availableAccountCount">
  >;

export function withDefaultImage2ProviderChannels(
  channels: Image2ProviderChannel[],
): Image2ProviderChannel[] {
  const existingIds = new Set(channels.map((channel) => channel.id));

  return [
    ...channels,
    ...IMAGE2_PROVIDER_CHANNEL_OPTIONS.filter(
      (channel) => !existingIds.has(channel.id),
    ).map((channel) => ({
      ...channel,
      accountCount: 0,
      availableAccountCount: 0,
    })),
  ];
}

export function getImage2ProviderChannel(
  channelId?: string | null,
  channels: ProviderChannelChoice[] = IMAGE2_PROVIDER_CHANNEL_OPTIONS,
): ProviderChannelChoice | null {
  if (!channelId) {
    return null;
  }

  const normalizedLegacyBaseUrl = resolveImage2ProviderChannelBaseUrl(channelId);
  const normalizedChannelId = normalizedLegacyBaseUrl
    ? channelIdFromBaseUrl(normalizedLegacyBaseUrl)
    : channelId;

  return channels.find((channel) => channel.id === normalizedChannelId) ?? null;
}

export function getImage2ProviderChannelName(
  channelId?: string | null,
  channels: ProviderChannelChoice[] = IMAGE2_PROVIDER_CHANNEL_OPTIONS,
): string | null {
  if (!channelId) {
    return null;
  }

  return (
    getImage2ProviderChannel(channelId, channels)?.displayName ??
    displayNameForImage2Channel(resolveImage2ProviderChannelBaseUrl(channelId))
  );
}

export function resolveProviderChannelId(
  modelId?: string | null,
  paramsRaw?: unknown,
  baseUrl?: string | null,
): ProviderChannelId | null {
  if (!supportsProviderChannels(modelId)) {
    return null;
  }

  const record =
    paramsRaw && typeof paramsRaw === "object"
      ? (paramsRaw as Record<string, unknown>)
      : null;
  const fromParams = record?.providerChannelId;

  if (isImage2ProviderChannelId(fromParams)) {
    const legacyBaseUrl = resolveImage2ProviderChannelBaseUrl(fromParams);
    return legacyBaseUrl ? channelIdFromBaseUrl(legacyBaseUrl) : fromParams;
  }

  const fromParamsBaseUrl = record?.providerChannelBaseUrl;
  const normalizedParamsBaseUrl =
    typeof fromParamsBaseUrl === "string" ? fromParamsBaseUrl : null;

  return inferProviderChannelIdFromBaseUrl(baseUrl ?? normalizedParamsBaseUrl);
}

export const resolveImage2ProviderChannelId = resolveProviderChannelId;

export function normalizeProviderChannelIdForModel(
  modelId?: string | null,
  channelId?: string | null,
): ProviderChannelId | undefined {
  if (!supportsProviderChannels(modelId)) {
    return undefined;
  }

  if (isImage2ProviderChannelId(channelId)) {
    const legacyBaseUrl = resolveImage2ProviderChannelBaseUrl(channelId);
    return legacyBaseUrl ? channelIdFromBaseUrl(legacyBaseUrl) : channelId.trim();
  }

  return undefined;
}

export const normalizeImage2ProviderChannelId =
  normalizeProviderChannelIdForModel;

export function isProviderChannelSelectable(
  channelId?: string | null,
  channels: ProviderChannelChoice[] = IMAGE2_PROVIDER_CHANNEL_OPTIONS,
): boolean {
  const channel = getImage2ProviderChannel(channelId, channels);

  if (!channel) {
    return false;
  }

  return typeof channel.availableAccountCount === "number"
    ? channel.availableAccountCount > 0
    : true;
}

export const isImage2ProviderChannelSelectable =
  isProviderChannelSelectable;

export function normalizeSelectableProviderChannelId(
  modelId?: string | null,
  channelId?: string | null,
  channels: ProviderChannelChoice[] = IMAGE2_PROVIDER_CHANNEL_OPTIONS,
): ProviderChannelId | undefined {
  if (!supportsProviderChannels(modelId)) {
    return undefined;
  }

  if (channels.length === 0) {
    return isImage2ModelId(modelId)
      ? DEFAULT_IMAGE2_PROVIDER_CHANNEL_ID
      : undefined;
  }

  const normalized = normalizeProviderChannelIdForModel(modelId, channelId);

  if (!normalized) {
    return channels[0]?.id ?? DEFAULT_IMAGE2_PROVIDER_CHANNEL_ID;
  }

  return isProviderChannelSelectable(normalized, channels)
    ? normalized
    : (channels.find(
        (channel) =>
          typeof channel.availableAccountCount !== "number" ||
          channel.availableAccountCount > 0,
      )?.id ??
        channels[0]?.id ??
        DEFAULT_IMAGE2_PROVIDER_CHANNEL_ID);
}

export const normalizeSelectableImage2ProviderChannelId =
  normalizeSelectableProviderChannelId;
