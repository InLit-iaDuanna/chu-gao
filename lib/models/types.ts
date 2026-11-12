export type AspectRatio =
  | "1:1"
  | "3:2"
  | "2:3"
  | "4:3"
  | "3:4"
  | "4:5"
  | "5:4"
  | "16:9"
  | "9:16"
  | "2:1"
  | "1:2"
  | "21:9"
  | "9:21";

// 计费档位（内部用）。由 size 派生，决定每张图的点数。
export type Resolution = "1K" | "2K" | "4K";

// 出图尺寸：用户面向的主参数，直接发给上游。
export type ImageSize =
  | "auto"
  | "512x512"
  | "768x768"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "2048x2048"
  | "2048x1152"
  | "3840x2160"
  | "2160x3840";

// 上游原生出图质量。不同模型通过 capabilities.qualities 声明可选子集。
export type ImageQuality = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type Image2Mode = "standard" | "high";

// 上游返回格式：
// - url：24h 缓存直链（含站点信息）
// - privacy_url：隐私直链（不含本站信息），同样 24h 缓存
// - b64_json：base64 数据（推荐 / 默认）
export type ResponseFormat = "url" | "privacy_url" | "b64_json";

export type ProviderChannelId = string;
export type Image2ProviderChannelId = ProviderChannelId;
export type ProtocolName =
  | "openai-images"
  | "openai-responses-image"
  | "gemini-image";
export type OutputFormat = "png" | "jpeg" | "webp" | "gif";
export type ImageBackground = "auto" | "opaque" | "transparent";
export type CostAxis = "resolution" | "flat";

export interface PricingRule {
  id: string;
  modelId: string;
  providerChannelId?: ProviderChannelId | null;
  image2Mode?: Image2Mode | null;
  resolution?: string | null;
  aspectRatio?: string | null;
  outputFormat?: string | null;
  background?: string | null;
  usesReference?: boolean | null;
  credits: number;
  priority: number;
}

export interface ModelCapabilities {
  // 出图尺寸（用户可选）。计费档位由 size 派生。
  sizes: ImageSize[];
  gifSizes?: ImageSize[];
  // 返回格式（用户可选）。
  responseFormats: ResponseFormat[];
  // 计费档位集合（内部，配合 costTable / 定价规则）。
  resolutions: Resolution[];
  qualities?: ImageQuality[];
  image2Modes?: Image2Mode[];
  supportsReferenceImage: boolean;
  maxReferenceImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  maxN: number;
  outputFormats: OutputFormat[];
  backgrounds: ImageBackground[];
  supportsOutputCompression: boolean;
}

export interface ModelDefinition {
  id: string;
  selectorId?: string;
  displayName: string;
  vendor: string;
  protocol: ProtocolName;
  capabilities: ModelCapabilities;
  defaults: {
    size: ImageSize;
    quality?: ImageQuality;
    responseFormat: ResponseFormat;
    image2Mode?: Image2Mode;
    outputFormat: OutputFormat;
    background: ImageBackground;
    outputCompression?: number;
  };
  costAxis: CostAxis;
  costTable: Record<string, number>;
  pricingRules?: PricingRule[];
  tagline?: string;
}

export type PublicModelDefinition = ModelDefinition & {
  available: boolean;
  fallbackCostMultiplier?: number;
  providerChannels?: PublicProviderChannel[];
};

export interface PublicProviderChannel {
  id: ProviderChannelId;
  displayName: string;
  accountCount: number;
  availableAccountCount: number;
}

export interface InternalReferenceImage {
  key: string;
  b64?: string;
  mimeType: string;
}

export interface InternalRequest {
  executionPolicy?: "single-submit";
  modelId: string;
  image2Mode?: Image2Mode;
  protocol: ProtocolName;
  providerChannelId?: ProviderChannelId;
  prompt: string;
  negativePrompt?: string;
  // 出图主参数
  size: ImageSize;
  quality: ImageQuality;
  responseFormat: ResponseFormat;
  // 由 size 派生，保留用于计费 / 存储 / 历史兼容
  aspectRatio: AspectRatio;
  resolution: Resolution;
  n: number;
  seed?: number;
  outputFormat: OutputFormat;
  background: ImageBackground;
  outputCompression?: number;
  referenceImages?: InternalReferenceImage[];
}
