import { fetchWithTimeout } from "@/lib/http";
import type {
  AspectRatio,
  InternalRequest,
  OutputFormat,
  Resolution,
} from "@/lib/models/types";
import { providerError } from "@/lib/providers/diagnostics";
import {
  RESOLUTION_TO_QUALITY,
  imagePixelSizeForRequest,
} from "@/lib/providers/image-params";
import type {
  GenerateResult,
  ProviderAdapter,
  ProviderConfig,
} from "@/lib/providers/types";

const TOOL_CHOICE_VALUES = new Set(["auto", "required", "none"]);

type ResponseInputContent =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
    };

type ResponsesImageOutput = {
  id?: string;
  type?: string;
  status?: string;
  result?: string;
  image?: string;
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
};

type ImageGenerationTool = {
  type: "image_generation";
  size?: string;
  quality?: string;
  output_format: OutputFormat;
  background?: string;
  output_compression?: number;
  model?: string;
};

function mimeTypeForFormat(format: OutputFormat): string {
  if (format === "jpeg") {
    return "image/jpeg";
  }

  if (format === "webp") {
    return "image/webp";
  }

  return "image/png";
}

function upstreamModelForRequest(): string {
  return (
    process.env.SUB2API_RESPONSES_MODEL ??
    process.env.OPENAI_RESPONSES_IMAGE_MODEL ??
    process.env.CONVERSATION_COMPILER_MODEL ??
    "gpt-5.5"
  );
}

function imageToolModelForRequest(): string | undefined {
  return (
    process.env.SUB2API_IMAGE_TOOL_MODEL ??
    process.env.OPENAI_RESPONSES_IMAGE_TOOL_MODEL
  );
}

function imageToolSizeForRequest(
  aspectRatio: AspectRatio,
  resolution: Resolution,
): string {
  const mode =
    process.env.SUB2API_RESPONSES_SIZE_MODE ??
    process.env.OPENAI_RESPONSES_IMAGE_SIZE_MODE ??
    "resolution";

  if (mode === "resolution") {
    return resolution;
  }

  return imagePixelSizeForRequest(aspectRatio, resolution, "OpenAI Responses");
}

function imageToolQualityForRequest(
  resolution: Resolution,
): string | undefined {
  const configured =
    process.env.SUB2API_RESPONSES_QUALITY ??
    process.env.OPENAI_RESPONSES_IMAGE_QUALITY;

  if (configured === "omit") {
    return undefined;
  }

  return configured ?? RESOLUTION_TO_QUALITY[resolution] ?? "medium";
}

function shouldSendOutputCompression(
  format: OutputFormat,
  value?: number,
): boolean {
  return value !== undefined && (format === "jpeg" || format === "webp");
}

function toolChoiceForRequest():
  | "auto"
  | "required"
  | "none"
  | object
  | undefined {
  const configured =
    process.env.SUB2API_RESPONSES_TOOL_CHOICE ??
    process.env.OPENAI_RESPONSES_IMAGE_TOOL_CHOICE ??
    "";

  if (!configured) {
    return undefined;
  }

  const normalized = configured.trim().toLowerCase();

  if (TOOL_CHOICE_VALUES.has(normalized)) {
    return normalized as "auto" | "required" | "none";
  }

  if (normalized === "image_generation") {
    return {
      type: "image_generation",
    };
  }

  return {
    type: "image_generation",
  };
}

function imageDataUrl(b64: string, mimeType: string): string {
  const marker = ";base64,";
  const markerIndex = b64.indexOf(marker);
  const normalized =
    markerIndex === -1 ? b64 : b64.slice(markerIndex + marker.length);

  return `data:${mimeType};base64,${normalized}`;
}

export function normalizeOpenAIResponsesBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("OpenAI Responses baseUrl is required");
  }

  const url = new URL(trimmed);
  url.pathname = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/v1\/responses$/i, "")
    .replace(/\/v1$/i, "");
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

function openAIResponsesUrl(baseUrl: string): string {
  return `${normalizeOpenAIResponsesBaseUrl(baseUrl)}/v1/responses`;
}

export class OpenAIResponsesImageAdapter implements ProviderAdapter {
  readonly protocol = "openai-responses-image" as const;

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
    const endpoint = openAIResponsesUrl(this.config.baseUrl);
    const images = [];
    const rawProviderResponses = [];

    for (let index = 0; index < req.n; index += 1) {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        signal,
        timeoutMs: 180_000,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.requestBody(req)),
      });
      const parsed = await this.parseResponse(response, req, endpoint);

      images.push(...parsed.images);
      rawProviderResponses.push(parsed.rawProviderResponse);
    }

    return {
      images,
      rawProviderResponse:
        rawProviderResponses.length === 1
          ? rawProviderResponses[0]
          : rawProviderResponses,
    };
  }

  private requestBody(req: InternalRequest) {
    const content: ResponseInputContent[] = [
      {
        type: "input_text",
        text: req.prompt,
      },
    ];

    for (const image of req.referenceImages ?? []) {
      if (!image.b64) {
        throw new Error(`reference image ${image.key} missing data`);
      }

      content.push({
        type: "input_image",
        image_url: imageDataUrl(image.b64, image.mimeType),
      });
    }

    const tool: ImageGenerationTool = {
      type: "image_generation",
      size: imageToolSizeForRequest(req.aspectRatio, req.resolution),
      quality: imageToolQualityForRequest(req.resolution),
      output_format: req.outputFormat,
      background: req.background,
    };
    const toolModel = imageToolModelForRequest();

    if (toolModel) {
      tool.model = toolModel;
    }

    if (shouldSendOutputCompression(req.outputFormat, req.outputCompression)) {
      tool.output_compression = req.outputCompression;
    }

    const body: {
      model: string;
      input:
        | string
        | {
            role: "user";
            content: ResponseInputContent[];
          }[];
      tools: ImageGenerationTool[];
      tool_choice?: "auto" | "required" | "none" | object;
    } = {
      model: upstreamModelForRequest(),
      input:
        content.length === 1 && content[0]?.type === "input_text"
          ? content[0].text
          : [
              {
                role: "user",
                content,
              },
            ],
      tools: [tool],
    };
    const toolChoice = toolChoiceForRequest();

    if (toolChoice) {
      body.tool_choice = toolChoice;
    }

    return body;
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
      output?: ResponsesImageOutput[];
    };
    const mimeType = mimeTypeForFormat(req.outputFormat);

    const images = (data.output ?? [])
      .filter((item) => item.type === "image_generation_call")
      .map((item) => ({
        b64: item.result ?? item.image ?? item.b64_json,
        url: item.url,
        width: 0,
        height: 0,
        mimeType,
      }))
      .filter((item) => item.b64 || item.url);

    return {
      images,
      rawProviderResponse: data,
    };
  }
}
