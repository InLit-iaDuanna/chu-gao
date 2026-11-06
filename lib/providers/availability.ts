import {
  channelIdFromBaseUrl,
  channelIdFromProvider,
  getImage2ProviderChannel,
  normalizeProviderChannelBaseUrl,
} from "@/lib/provider-channels";

export function supportedModelIds(modelId: string): string[] {
  if (modelId === "gpt-image-2") {
    return [modelId, "gpt-image-2-standard", "gpt-image-2-high"];
  }

  if (modelId === "nano-banana-2-512") {
    return [modelId];
  }

  return [modelId];
}

export function providerChannelMatchesBaseUrl(
  providerChannelId: string | undefined | null,
  baseUrl?: string | null,
  providerId?: string | null,
): boolean {
  if (!providerChannelId) {
    return true;
  }

  const normalizedBaseUrl = normalizeProviderChannelBaseUrl(baseUrl);

  if (!normalizedBaseUrl) {
    return false;
  }

  return (
    channelIdFromBaseUrl(normalizedBaseUrl) === providerChannelId ||
    (providerId
      ? channelIdFromProvider(providerId, normalizedBaseUrl) === providerChannelId
      : false) ||
    getImage2ProviderChannel(providerChannelId)?.baseUrl === normalizedBaseUrl
  );
}
