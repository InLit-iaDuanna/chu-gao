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
  | "21:9"
  | "9:21";

export type Resolution = "1K" | "2K" | "4K";
export type ProtocolName =
  | "openai-images"
  | "openai-responses-image"
  | "gemini-image";
export type OutputFormat = "png" | "jpeg" | "webp";
export type ImageBackground = "auto" | "opaque" | "transparent";
export type CostAxis = "resolution" | "flat";

export interface PricingRule {
  id: string;
  modelId: string;
  resolution?: string | null;
  aspectRatio?: string | null;
  outputFormat?: string | null;
  background?: string | null;
  usesReference?: boolean | null;
  credits: number;
  priority: number;
}

export interface ModelCapabilities {
  aspectRatios: AspectRatio[];
  resolutions: Resolution[];
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
  displayName: string;
  vendor: string;
  protocol: ProtocolName;
  capabilities: ModelCapabilities;
  defaults: {
    aspectRatio: AspectRatio;
    resolution: Resolution;
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
};

export interface InternalReferenceImage {
  key: string;
  b64?: string;
  mimeType: string;
}

export interface InternalRequest {
  modelId: string;
  protocol: ProtocolName;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  n: number;
  seed?: number;
  outputFormat: OutputFormat;
  background: ImageBackground;
  outputCompression?: number;
  referenceImages?: InternalReferenceImage[];
}
