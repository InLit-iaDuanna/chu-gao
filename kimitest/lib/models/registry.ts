import type { ModelDefinition, ProtocolName } from "@/lib/models/types";
import {
  IMAGE_SIZE_OPTIONS,
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
      image2Modes: ["standard", "high"],
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
      responseFormat: "b64_json",
      image2Mode: "standard",
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

export function getModel(id: string): ModelDefinition | null {
  return MODELS[id] ?? null;
}

export function listModels(): ModelDefinition[] {
  return Object.values(MODELS);
}

export function modelsByProtocol(protocol: ProtocolName): ModelDefinition[] {
  return listModels().filter((model) => model.protocol === protocol);
}
