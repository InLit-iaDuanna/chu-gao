import type { ModelDefinition, ProtocolName } from "@/lib/models/types";

export const MODELS: Record<string, ModelDefinition> = {
  "gpt-image-2": {
    id: "gpt-image-2",
    displayName: "Image2",
    vendor: "image2",
    protocol: "openai-images",
    capabilities: {
      aspectRatios: [
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "5:4",
        "4:5",
        "16:9",
        "9:16",
      ],
      resolutions: ["1K", "2K", "4K"],
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
      aspectRatio: "1:1",
      resolution: "2K",
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
  "gemini-2.5-flash-image": {
    id: "gemini-2.5-flash-image",
    displayName: "Nano Banana",
    vendor: "Google",
    protocol: "gemini-image",
    capabilities: {
      aspectRatios: [
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "4:5",
        "5:4",
        "16:9",
        "9:16",
        "21:9",
      ],
      resolutions: ["1K", "2K", "4K"],
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
      aspectRatio: "1:1",
      resolution: "1K",
      outputFormat: "png",
      background: "auto",
    },
    costAxis: "resolution",
    costTable: {
      "1K": 2,
      "2K": 6,
      "4K": 14,
    },
    tagline: "风格自然，长于氛围、人物与材质。",
  },
  "gemini-2.5-flash-image-pro": {
    id: "gemini-2.5-flash-image-pro",
    displayName: "Nano Banana Pro",
    vendor: "Google",
    protocol: "gemini-image",
    capabilities: {
      aspectRatios: [
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "4:5",
        "5:4",
        "16:9",
        "9:16",
        "21:9",
      ],
      resolutions: ["1K", "2K", "4K"],
      supportsReferenceImage: true,
      maxReferenceImages: 6,
      supportsNegativePrompt: false,
      supportsSeed: false,
      maxN: 1,
      outputFormats: ["png"],
      backgrounds: ["auto"],
      supportsOutputCompression: false,
    },
    defaults: {
      aspectRatio: "1:1",
      resolution: "2K",
      outputFormat: "png",
      background: "auto",
    },
    costAxis: "resolution",
    costTable: {
      "1K": 4,
      "2K": 8,
      "4K": 20,
    },
    tagline: "高分辨率输出，适合打样、印刷与精修。",
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
