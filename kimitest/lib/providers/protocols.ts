import type { ProviderProtocol } from "@prisma/client";

import type { ProtocolName } from "@/lib/models/types";
import { normalizeOpenAIImagesBaseUrl } from "@/lib/providers/openai-images";
import { normalizeOpenAIResponsesBaseUrl } from "@/lib/providers/openai-responses-image";

const PROVIDER_TO_MODEL_PROTOCOL: Record<ProviderProtocol, ProtocolName> = {
  OPENAI_IMAGES: "openai-images",
  OPENAI_RESPONSES_IMAGE: "openai-responses-image",
  GEMINI_IMAGE: "gemini-image",
};

const MODEL_TO_PROVIDER_PROTOCOL: Record<ProtocolName, ProviderProtocol> = {
  "openai-images": "OPENAI_IMAGES",
  "openai-responses-image": "OPENAI_RESPONSES_IMAGE",
  "gemini-image": "GEMINI_IMAGE",
};

export function providerProtocolToModelProtocol(
  protocol: ProviderProtocol,
): ProtocolName {
  return PROVIDER_TO_MODEL_PROTOCOL[protocol];
}

export function modelProtocolToProviderProtocol(
  protocol: ProtocolName,
): ProviderProtocol {
  return MODEL_TO_PROVIDER_PROTOCOL[protocol];
}

export function normalizeProviderBaseUrl(
  value: string,
  protocol: ProviderProtocol,
): string {
  if (protocol === "OPENAI_IMAGES") {
    return normalizeOpenAIImagesBaseUrl(value);
  }

  if (protocol === "OPENAI_RESPONSES_IMAGE") {
    return normalizeOpenAIResponsesBaseUrl(value);
  }

  return value.trim().replace(/\/+$/, "");
}
