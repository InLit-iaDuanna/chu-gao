export type Image2ProviderChannelId = "aquatic" | "terrestrial";

export const DEFAULT_IMAGE2_PROVIDER_CHANNEL_ID: Image2ProviderChannelId =
  "terrestrial";

export const IMAGE2_PROVIDER_CHANNELS: Record<
  Image2ProviderChannelId,
  {
    id: Image2ProviderChannelId;
    displayName: string;
    baseUrl: string;
    unavailableReason?: string;
  }
> = {
  aquatic: {
    id: "aquatic",
    displayName: "水生动物渠道（维护中）",
    baseUrl: "https://lucen.cc",
    unavailableReason: "当前上游维护中",
  },
  terrestrial: {
    id: "terrestrial",
    displayName: "陆生动物渠道",
    baseUrl: "https://api.xpzhao.top",
  },
};

export const IMAGE2_PROVIDER_CHANNEL_OPTIONS = Object.values(
  IMAGE2_PROVIDER_CHANNELS,
);

export function isImage2ProviderChannelId(
  value: unknown,
): value is Image2ProviderChannelId {
  return value === "aquatic" || value === "terrestrial";
}

export function isImage2ModelId(modelId?: string | null): boolean {
  return modelId === "gpt-image-2";
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

export function inferImage2ProviderChannelIdFromBaseUrl(
  baseUrl?: string | null,
): Image2ProviderChannelId | null {
  const normalized = normalizeProviderChannelBaseUrl(baseUrl);

  if (!normalized) {
    return null;
  }

  const matched = IMAGE2_PROVIDER_CHANNEL_OPTIONS.find(
    (channel) =>
      normalizeProviderChannelBaseUrl(channel.baseUrl) === normalized,
  );

  return matched?.id ?? null;
}

export function getImage2ProviderChannel(
  channelId?: string | null,
): (typeof IMAGE2_PROVIDER_CHANNELS)[Image2ProviderChannelId] | null {
  if (!isImage2ProviderChannelId(channelId)) {
    return null;
  }

  return IMAGE2_PROVIDER_CHANNELS[channelId];
}

export function getImage2ProviderChannelName(
  channelId?: string | null,
): string | null {
  return getImage2ProviderChannel(channelId)?.displayName ?? null;
}

export function resolveImage2ProviderChannelId(
  modelId?: string | null,
  paramsRaw?: unknown,
  baseUrl?: string | null,
): Image2ProviderChannelId | null {
  if (!isImage2ModelId(modelId)) {
    return null;
  }

  const record =
    paramsRaw && typeof paramsRaw === "object"
      ? (paramsRaw as Record<string, unknown>)
      : null;
  const fromParams = record?.providerChannelId;

  if (isImage2ProviderChannelId(fromParams)) {
    return fromParams;
  }

  return inferImage2ProviderChannelIdFromBaseUrl(baseUrl);
}

export function normalizeImage2ProviderChannelId(
  modelId?: string | null,
  channelId?: string | null,
): Image2ProviderChannelId | undefined {
  if (!isImage2ModelId(modelId)) {
    return undefined;
  }

  return isImage2ProviderChannelId(channelId)
    ? channelId
    : DEFAULT_IMAGE2_PROVIDER_CHANNEL_ID;
}

export function isImage2ProviderChannelSelectable(
  channelId?: string | null,
): boolean {
  const channel = getImage2ProviderChannel(channelId);

  return Boolean(channel && !channel.unavailableReason);
}

export function normalizeSelectableImage2ProviderChannelId(
  modelId?: string | null,
  channelId?: string | null,
): Image2ProviderChannelId | undefined {
  const normalized = normalizeImage2ProviderChannelId(modelId, channelId);

  if (!normalized) {
    return undefined;
  }

  return isImage2ProviderChannelSelectable(normalized)
    ? normalized
    : DEFAULT_IMAGE2_PROVIDER_CHANNEL_ID;
}
