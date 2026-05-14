import { PROVIDER_FETCH_RETRY, fetchWithTimeout } from "@/lib/http";
import type {
  GenerateProgressCallback,
  GenerateResult,
  ProviderAdapter,
  ProviderConfig,
} from "@/lib/providers/types";
import type { InternalRequest } from "@/lib/models/types";
import { providerError } from "@/lib/providers/diagnostics";
import { providerRequestTimeoutMs } from "@/lib/providers/config";
import {
  RESOLUTION_TO_QUALITY,
  imagePixelSizeForRequest,
} from "@/lib/providers/image-params";

const TASK_POLL_INTERVAL_MS = 1500;

type OpenAIImageTaskStatus = "queued" | "in_progress" | "completed" | "failed";

type OpenAIImageItem = {
  b64_json?: string;
  url?: string;
};

type OpenAIImageTaskResponse = {
  id?: string;
  object?: string;
  status?: OpenAIImageTaskStatus | string;
  progress?: number;
  error?: {
    message?: string;
  } | null;
  data?: OpenAIImageItem[];
  result?: {
    data?: OpenAIImageItem[];
    images?: OpenAIImageItem[];
  } | null;
  images?: OpenAIImageItem[];
};

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

function openAIImageTaskUrl(baseUrl: string, taskId: string): string {
  return `${normalizeOpenAIImagesBaseUrl(baseUrl)}/v1/images/generations/${taskId}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Request aborted"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("Request aborted"));
    }

    signal.addEventListener("abort", onAbort);
  });
}

function normalizeProgress(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function isTaskResponse(payload: unknown): payload is OpenAIImageTaskResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.object === "generation.task" ||
    typeof record.status === "string" ||
    typeof record.progress === "number"
  );
}

function extractImageItems(payload: OpenAIImageTaskResponse): OpenAIImageItem[] {
  const buckets = [
    payload.data,
    payload.images,
    payload.result?.data,
    payload.result?.images,
  ];

  return buckets
    .flatMap((items) => items ?? [])
    .filter((item) => item?.b64_json || item?.url);
}

function imageSizeForRequest(req: InternalRequest): string {
  return imagePixelSizeForRequest(req.aspectRatio, req.resolution, "OpenAI");
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
    onProgress?: GenerateProgressCallback,
  ): Promise<GenerateResult> {
    const size = imageSizeForRequest(req);

    if (req.referenceImages?.length) {
      const form = new FormData();
      form.append("model", req.modelId);
      form.append("prompt", req.prompt);
      form.append("n", String(req.n));
      form.append("size", size);
      form.append("resolution", req.resolution);
      form.append("response_format", "url");
      form.append("output_format", req.outputFormat);
      form.append("background", req.background);
      form.append("quality", RESOLUTION_TO_QUALITY[req.resolution] ?? "medium");

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
        timeoutMs: providerRequestTimeoutMs(),
        retry: PROVIDER_FETCH_RETRY,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: form,
      });

      return this.parseResponse(response, req, endpoint, signal, onProgress);
    }

    const endpoint = openAIImagesUrl(
      this.config.baseUrl,
      "/images/generations",
    );
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      signal,
      timeoutMs: providerRequestTimeoutMs(),
      retry: PROVIDER_FETCH_RETRY,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: req.modelId,
        prompt: req.prompt,
        n: req.n,
        size,
        resolution: req.resolution,
        response_format: "url",
        output_format: req.outputFormat,
        background: req.background,
        quality: RESOLUTION_TO_QUALITY[req.resolution] ?? "medium",
        ...(shouldSendOutputCompression(req.outputFormat, req.outputCompression)
          ? { output_compression: req.outputCompression }
          : {}),
      }),
    });

    return this.parseResponse(response, req, endpoint, signal, onProgress);
  }

  private async parseResponse(
    response: Response,
    req: InternalRequest,
    endpoint: string,
    signal: AbortSignal,
    onProgress?: GenerateProgressCallback,
  ): Promise<GenerateResult> {
    if (!response.ok) {
      throw await providerError(
        response,
        this.config.name,
        this.protocol,
        endpoint,
      );
    }

    const data = (await response.json()) as
      | OpenAIImageTaskResponse
      | {
          data?: OpenAIImageItem[];
        };
    const mimeType = mimeTypeForFormat(req.outputFormat);

    if (isTaskResponse(data)) {
      return this.resolveTask(data, req, signal, onProgress);
    }

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

  private async resolveTask(
    initialTask: OpenAIImageTaskResponse,
    req: InternalRequest,
    signal: AbortSignal,
    onProgress?: GenerateProgressCallback,
  ): Promise<GenerateResult> {
    let task = initialTask;

    await onProgress?.({
      status:
        task.status === "queued" ||
        task.status === "in_progress" ||
        task.status === "completed" ||
        task.status === "failed"
          ? task.status
          : undefined,
      progress:
        task.status === "completed"
          ? 100
          : normalizeProgress(task.progress) ?? 0,
      rawProviderResponse: task,
    });

    while (task.status === "queued" || task.status === "in_progress") {
      await sleep(TASK_POLL_INTERVAL_MS, signal);
      const statusEndpoint = openAIImageTaskUrl(
        this.config.baseUrl,
        String(task.id ?? ""),
      );
      const response = await fetchWithTimeout(statusEndpoint, {
        method: "GET",
        signal,
        timeoutMs: providerRequestTimeoutMs(),
        retry: PROVIDER_FETCH_RETRY,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw await providerError(
          response,
          this.config.name,
          this.protocol,
          statusEndpoint,
        );
      }

      task = (await response.json()) as OpenAIImageTaskResponse;
      await onProgress?.({
        status:
          task.status === "queued" ||
          task.status === "in_progress" ||
          task.status === "completed" ||
          task.status === "failed"
            ? task.status
            : undefined,
        progress:
          task.status === "completed"
            ? 100
            : normalizeProgress(task.progress) ?? 0,
        rawProviderResponse: task,
      });
    }

    if (task.status === "failed") {
      throw new Error(task.error?.message ?? "Image task failed");
    }

    const mimeType = mimeTypeForFormat(req.outputFormat);
    const items = extractImageItems(task);

    return {
      images: items.map((item) => ({
        b64: item.b64_json,
        url: item.url,
        width: 0,
        height: 0,
        mimeType,
      })),
      rawProviderResponse: task,
    };
  }
}
