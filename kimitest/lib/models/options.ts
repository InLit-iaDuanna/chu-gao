import type {
  AspectRatio,
  ImageSize,
  Resolution,
  ResponseFormat,
} from "@/lib/models/types";

export const IMAGE_ASPECT_RATIO_OPTIONS = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
] as const satisfies readonly AspectRatio[];

export const IMAGE_RESOLUTION_OPTIONS = [
  "1K",
  "2K",
  "4K",
] as const satisfies readonly Resolution[];

// 旧版「分辨率×比例」映射，仅保留供历史 system-config 行 / ConfigEditor 兼容使用，
// 新版出图主参数已改为显式 size，不再参与出图请求构建。
export const IMAGE2_DEFAULT_RESOLUTION_ASPECT_RATIOS = {
  "1K": ["1:1", "3:2", "2:3"],
  "2K": [...IMAGE_ASPECT_RATIO_OPTIONS],
  "4K": ["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"],
} as const satisfies Record<Resolution, readonly AspectRatio[]>;

// 用户可选的出图尺寸（出图主参数）。
export const IMAGE_SIZE_OPTIONS = [
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
] as const satisfies readonly ImageSize[];

export const IMAGE_SIZE_LABEL: Record<ImageSize, string> = {
  auto: "自动",
  "1024x1024": "1024×1024 · 方形",
  "1536x1024": "1536×1024 · 横版 3:2",
  "1024x1536": "1024×1536 · 竖版 2:3",
  "2048x2048": "2048×2048 · 方形 2K",
  "2048x1152": "2048×1152 · 横版 16:9",
  "3840x2160": "3840×2160 · 横版 4K",
  "2160x3840": "2160×3840 · 竖版 4K",
};

export const RESPONSE_FORMAT_OPTIONS = [
  "b64_json",
  "url",
  "privacy_url",
] as const satisfies readonly ResponseFormat[];

export const RESPONSE_FORMAT_LABEL: Record<ResponseFormat, string> = {
  b64_json: "Base64 数据（推荐）",
  url: "直链 URL（24h 缓存，请及时下载）",
  privacy_url: "隐私直链（不含本站信息，24h 缓存）",
};

// size → 预估计费档位（1K/2K/4K）。auto 先按最低档预扣，完成后按实际返回尺寸结算。
export function resolutionTierForSize(size: ImageSize): Resolution {
  switch (size) {
    case "2048x2048":
    case "2048x1152":
      return "2K";
    case "3840x2160":
    case "2160x3840":
      return "4K";
    case "1024x1024":
    case "1536x1024":
    case "1024x1536":
    case "auto":
    default:
      return "1K";
  }
}

// 实际返回宽高 → 最终计费档位。
export function resolutionTierForDimensions(
  width?: number | null,
  height?: number | null,
): Resolution {
  const longestEdge = Math.max(width ?? 0, height ?? 0);

  if (longestEdge >= 3840) {
    return "4K";
  }

  if (longestEdge >= 2048) {
    return "2K";
  }

  return "1K";
}

// size → 比例（派生，仅用于存储 / 历史兼容展示）。
export function aspectRatioForSize(size: ImageSize): AspectRatio {
  switch (size) {
    case "1536x1024":
      return "3:2";
    case "1024x1536":
      return "2:3";
    case "2048x1152":
    case "3840x2160":
      return "16:9";
    case "2160x3840":
      return "9:16";
    case "1024x1024":
    case "2048x2048":
    case "auto":
    default:
      return "1:1";
  }
}
