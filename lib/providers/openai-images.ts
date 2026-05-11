import { fetchWithTimeout } from "@/lib/http";
import type {
  GenerateResult,
  ProviderAdapter,
  ProviderConfig,
} from "@/lib/providers/types";
import type { InternalRequest } from "@/lib/models/types";
import { providerError } from "@/lib/providers/diagnostics";
import {
  RESOLUTION_TO_QUALITY,
  imagePixelSizeForRequest,
} from "@/lib/providers/image-params";

function mimeTypeForFormat(format: string): string {
  if (format === "jpeg") {
    return "image/jpeg";
  }

  if (format === "webp") {
    return "image/webp";
  }

  return "image/png";
}

function shouldSendOutputCompression(format: string, value?: number): boolean {
  return value !== undefined && (format === "jpeg" || format === "webp");
}

function base64ToBlob(value: string, mimeType: string): Blob {
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  const normalized =
    markerIndex === -1 ? value : value.slice(markerIndex + marker.length);
  const bytes = Buffer.from(normalized, "base64");

  return new Blob([bytes], { type: mimeType });
}

export function normalizeOpenAIImagesBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("OpenAI Images baseUrl is required");
  }

  const url = new URL(trimmed);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "");
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

function openAIImagesUrl(
  baseUrl: string,
  path: "/images/edits" | "/images/generations",
): string {
  return `${normalizeOpenAIImagesBaseUrl(baseUrl)}/v1${path}`;
}

export class OpenAIImagesAdapter implements ProviderAdapter {
  readonly protocol = "openai-images" as const;

  constructor(private readonly config: ProviderConfig) {}

  get id() {
    return this.config.id;
  }

  get name() {
    return this.config.name;
  }

  async generate(
    req: InternalRequest,
    signal: AbortSignal,
  ): Promise<GenerateResult> {
    const size = imagePixelSizeForRequest(
      req.aspectRatio,
      req.resolution,
      "OpenAI",
    );

    if (req.referenceImages?.length) {
      const form = new FormData();
      form.append("model", req.modelId);
      form.append("prompt", req.prompt);
      form.append("n", String(req.n));
      form.append("size", size);
      form.append("quality", RESOLUTION_TO_QUALITY[req.resolution] ?? "medium");
      form.append("output_format", req.outputFormat);
      form.append("background", req.background);

      if (
        shouldSendOutputCompression(req.outputFormat, req.outputCompression)
      ) {
        form.append("output_compression", String(req.outputCompression));
      }

      for (const image of req.referenceImages) {
        if (!image.b64) {
          throw new Error(`reference image ${image.key} missing data`);
        }

        form.append(
          "image",
          base64ToBlob(image.b64, image.mimeType),
          "reference.png",
        );
      }

      const endpoint = openAIImagesUrl(this.config.baseUrl, "/images/edits");
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        signal,
        timeoutMs: 180_000,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: form,
      });

      return this.parseResponse(response, req, endpoint);
    }

    const endpoint = openAIImagesUrl(
      this.config.baseUrl,
      "/images/generations",
    );
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      signal,
      timeoutMs: 180_000,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: req.modelId,
        prompt: req.prompt,
        n: req.n,
        size,
        quality: RESOLUTION_TO_QUALITY[req.resolution] ?? "medium",
        output_format: req.outputFormat,
        background: req.background,
        ...(shouldSendOutputCompression(req.outputFormat, req.outputCompression)
          ? { output_compression: req.outputCompression }
          : {}),
      }),
    });

    return this.parseResponse(response, req, endpoint);
  }

  private async parseResponse(
    response: Response,
    req: InternalRequest,
    endpoint: string,
  ): Promise<GenerateResult> {
    if (!response.ok) {
      throw await providerError(
        response,
        this.config.name,
        this.protocol,
        endpoint,
      );
    }

    const data = (await response.json()) as {
      data?: Array<{
        b64_json?: string;
        url?: string;
      }>;
    };
    const mimeType = mimeTypeForFormat(req.outputFormat);

    return {
      images: (data.data ?? [])
        .filter((item) => item.b64_json || item.url)
        .map((item) => ({
          b64: item.b64_json,
          url: item.url,
          width: 0,
          height: 0,
          mimeType,
        })),
      rawProviderResponse: data,
    };
  }
}
