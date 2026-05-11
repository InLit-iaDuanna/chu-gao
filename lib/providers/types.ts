import type { InternalRequest, ProtocolName } from "@/lib/models/types";

export interface GeneratedImageData {
  b64?: string;
  url?: string;
  width: number;
  height: number;
  mimeType: string;
}

export interface GenerateResult {
  images: GeneratedImageData[];
  rawProviderResponse?: unknown;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly protocol: ProtocolName;
  generate(req: InternalRequest, signal: AbortSignal): Promise<GenerateResult>;
}

export interface ProviderConfig {
  id: string;
  name: string;
  protocol: ProtocolName;
  baseUrl: string;
  apiKey: string;
}
