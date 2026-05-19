import { PROVIDER_FETCH_RETRY, fetchWithTimeout } from "@/lib/http";
import type { InternalRequest } from "@/lib/models/types";
import { providerError } from "@/lib/providers/diagnostics";
import { providerRequestTimeoutMs } from "@/lib/providers/config";
import type {
  GenerateResult,
  ProviderAdapter,
  ProviderConfig,
} from "@/lib/providers/types";

export class GeminiImageAdapter implements ProviderAdapter {
  readonly protocol = "gemini-image" as const;

  constructor(private readonly config: ProviderConfig) {}

  get id() {
    return this.config.id;
  }

  get name() {
    return this.config.name;
  }

  private endpointForModel(modelId: string): string {
    return `${this.config.baseUrl}/v1beta/models/${modelId}:generateContent`;
  }

  async generate(
    req: InternalRequest,
    signal: AbortSignal,
  ): Promise<GenerateResult> {
    const parts: Array<
      | { text: string }
      | {
          inline_data: {
            mime_type: string;
            data: string;
          };
        }
    > = [{ text: req.prompt }];

    for (const image of req.referenceImages ?? []) {
      if (!image.b64) {
        throw new Error(`reference image ${image.key} missing data`);
      }

      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.b64,
        },
      });
    }

    const endpoint = this.endpointForModel(req.modelId);
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      signal,
      timeoutMs: providerRequestTimeoutMs(),
      retry: PROVIDER_FETCH_RETRY,
      headers: {
        "x-goog-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: req.aspectRatio,
          },
        },
      }),
    });

    if (!response.ok) {
      throw await providerError(
        response,
        this.config.name,
        this.protocol,
        endpoint,
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: {
              data?: string;
              mimeType?: string;
            };
            inline_data?: {
              data?: string;
              mime_type?: string;
            };
          }>;
        };
      }>;
    };
    const firstCandidate = data.candidates?.[0];
    const images =
      firstCandidate?.content?.parts
        ?.map((part) => part.inlineData ?? part.inline_data)
        .filter(
          (
            inlineData,
          ): inlineData is {
            data: string;
            mimeType?: string;
            mime_type?: string;
          } => Boolean(inlineData?.data),
        )
        .map((inlineData) => ({
          b64: inlineData.data,
          width: 0,
          height: 0,
          mimeType: inlineData.mimeType ?? inlineData.mime_type ?? "image/png",
        })) ?? [];

    return {
      images,
      rawProviderResponse: data,
    };
  }
}
