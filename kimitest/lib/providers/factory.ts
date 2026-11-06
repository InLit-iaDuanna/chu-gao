import { GeminiImageAdapter } from "@/lib/providers/gemini-image";
import { OpenAIImagesAdapter } from "@/lib/providers/openai-images";
import { OpenAIResponsesImageAdapter } from "@/lib/providers/openai-responses-image";
import type { ProviderAdapter, ProviderConfig } from "@/lib/providers/types";

export function buildAdapter(config: ProviderConfig): ProviderAdapter {
  if (config.protocol === "openai-images") {
    return new OpenAIImagesAdapter(config);
  }

  if (config.protocol === "openai-responses-image") {
    return new OpenAIResponsesImageAdapter(config);
  }

  if (config.protocol === "gemini-image") {
    return new GeminiImageAdapter(config);
  }

  throw new Error(`Unsupported provider protocol: ${config.protocol}`);
}
