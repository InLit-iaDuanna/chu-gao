import type {
  ImageBackground,
  OutputFormat,
  Resolution,
} from "@/lib/models/types";

export interface WorkbenchState {
  modelId: string;
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
  errorCode?: string | null;
  errorMessage?: string | null;
  credits?: number;
  costCredits?: number;
  images: Array<{
    id?: string;
    src?: string;
    url?: string;
    width?: number;
    height?: number;
    mimeType?: string;
  }>;
}
