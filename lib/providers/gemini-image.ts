import { PROVIDER_FETCH_RETRY, fetchWithTimeout } from "@/lib/http";
import type { InternalRequest } from "@/lib/models/types";
import { providerError } from "@/lib/providers/diagnostics";
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

  async generate(
    req: InternalRequest,
    signal: AbortSignal,
  ): Promise<GenerateResult> {
    const parts: Array<
      | { text: string }
      | {
          inlineData: {
            mimeType: string;
            data: string;
          };
        }
    > = [{ text: req.prompt }];

    for (const image of req.referenceImages ?? []) {
      if (!image.b64) {
        throw new Error(`reference image ${image.key} missing data`);
      }

      parts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.b64,
        },
      });
    }

    const imageConfig: Record<string, string> = {
      aspectRatio: req.aspectRatio,
      imageSize: req.resolution,
    };

    const endpoint = `${this.config.baseUrl}/v1beta/models/${req.modelId}:generateContent`;
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      signal,
      timeoutMs: 90_000,
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
          responseModalities: ["IMAGE"],
          imageConfig,
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
