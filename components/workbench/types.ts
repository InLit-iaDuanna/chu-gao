import type {
  ImageBackground,
  OutputFormat,
  ProviderChannelId,
  Resolution,
} from "@/lib/models/types";

export interface WorkbenchState {
  modelId: string;
  providerChannelId?: ProviderChannelId;
  negativePrompt?: string;
  aspectRatio: string;
  resolution: Resolution;
  n: number;
  seed?: number;
  outputFormat: OutputFormat;
  background: ImageBackground;
  outputCompression?: number;
  referenceImageKeys: string[];
}

export interface UploadedReferenceImage {
  key: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  previewUrl: string;
}

export type WorkbenchTaskStatus =
  | "idle"
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export interface WorkbenchGeneration {
  id: string;
  conversationId?: string | null;
  modelId?: string;
  prompt: string;
  status: string;
  createdAt: string;
  aspectRatio?: string;
  resolution?: string | null;
  outputFormat?: string;
  provider?: string | null;
  providerChannelId?: ProviderChannelId | null;
  providerChannelName?: string | null;
  providerAccountName?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  progress?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  credits?: number;
  costCredits?: number;
  images: Array<{
    id?: string;
    src?: string;
    url?: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    mimeType?: string;
  }>;
}
