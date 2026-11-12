import type { ModelDefinition, ProtocolName } from "@/lib/models/types";
import {
  IMAGE_SIZE_OPTIONS,
  GIF_SIZE_OPTIONS,
  RESPONSE_FORMAT_OPTIONS,
} from "@/lib/models/options";

export const MODELS: Record<string, ModelDefinition> = {
  "gpt-image-2": {
    id: "gpt-image-2",
    displayName: "Image2",
    vendor: "动物通道",
    protocol: "openai-images",
    capabilities: {
      sizes: [...IMAGE_SIZE_OPTIONS],
      responseFormats: [...RESPONSE_FORMAT_OPTIONS],
      resolutions: ["1K", "2K", "4K"],
      qualities: ["low", "medium", "high"],
      supportsReferenceImage: true,
      maxReferenceImages: 16,
      supportsNegativePrompt: false,
      supportsSeed: false,
      maxN: 4,
      outputFormats: ["png", "jpeg", "webp"],
      backgrounds: ["auto", "opaque"],
      supportsOutputCompression: true,
    },
    defaults: {
      size: "auto",
      quality: "high",
      responseFormat: "b64_json",
      outputFormat: "png",
      background: "auto",
    },
    costAxis: "resolution",
    costTable: {
      "1K": 2,
      "2K": 8,
      "4K": 20,
    },
    tagline: "指令精准，适合海报、字体与排版类画面。",
  },
  "nano-banana-2-512": {
    id: "nano-banana-2-512",
    selectorId: "nano-banana",
    displayName: "Nano Banana 2",
    vendor: "Google",
    protocol: "gemini-image",
    capabilities: {
      sizes: ["auto", "1024x1024", "1536x1024", "1024x1536"],
      responseFormats: [...RESPONSE_FORMAT_OPTIONS],
      resolutions: ["1K"],
      qualities: ["auto"],
      supportsReferenceImage: true,
      maxReferenceImages: 4,
      supportsNegativePrompt: false,
      supportsSeed: false,
      maxN: 1,
      outputFormats: ["png"],
      backgrounds: ["auto"],
      supportsOutputCompression: false,
    },
    defaults: {
      size: "1024x1024",
      quality: "auto",
      responseFormat: "b64_json",
      outputFormat: "png",
      background: "auto",
    },
    costAxis: "resolution",
    costTable: {
      "1K": 2,
    },
    tagline: "风格自然，长于氛围、人物与材质。",
  },
};

for (const [id, displayName] of [
  ["gpt-image-2.5-flare", "Image 2.5 Flare"],
  ["gpt-image-2.5-sunburst", "Image 2.5 Sunburst"],
  ["gpt-image-2.6", "Image 2.6"],
  ["gpt-image-2.6-flare", "Image 2.6 Flare"],
  ["gpt-image-2.6-sunburst", "Image 2.6 Sunburst"],
] as const) {
  const base = MODELS["gpt-image-2"];
  const { image2Modes: _modes, ...capabilities } = base.capabilities;
  const { image2Mode: _mode, ...defaults } = base.defaults;
  MODELS[id] = {
    ...base,
    id,
    displayName,
    capabilities: {
      ...capabilities,
      qualities: ["low", "medium", "high", "xhigh", "max"],
      maxN: 1,
      outputFormats: id.startsWith("gpt-image-2.6") ? ["png", "gif"] : ["png"],
      ...(id.startsWith("gpt-image-2.6")
        ? { gifSizes: [...GIF_SIZE_OPTIONS] }
        : {}),
      backgrounds: ["auto"],
      supportsOutputCompression: false,
    },
    defaults: { ...defaults, quality: "high" },
    costTable: { ...base.costTable },
  };
}

export function getModel(id: string): ModelDefinition | null {
  return MODELS[id] ?? null;
}

export function listModels(): ModelDefinition[] {
  return Object.values(MODELS);
}

export function modelsByProtocol(protocol: ProtocolName): ModelDefinition[] {
  return listModels().filter((model) => model.protocol === protocol);
}
