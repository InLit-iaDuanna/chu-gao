import sharp from "sharp";
import { z } from "zod";

import { getOpusConfig } from "@/lib/opus-config";
import { fetchWithTimeout } from "@/lib/http";
import { withModelCall, type ModelCallContext } from "@/lib/model-call-log";
import { providerError } from "@/lib/providers/diagnostics";

export interface VisionImagePart {
  type: "image_url";
  image_url: {
    url: string;
    detail: "auto";
  };
}

const MAX_VISION_IMAGE_BYTES = 1_400_000;

/**
 * Keep private source images on the server and send only a bounded preview to
 * the configured vision-capable conversation model.
 */
export async function toVisionImagePart(
  buffer: Buffer,
): Promise<VisionImagePart> {
  const preview = await sharp(buffer, {
    failOn: "error",
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .resize({
      width: 1536,
      height: 1536,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();

  if (preview.length > MAX_VISION_IMAGE_BYTES) {
    throw new Error("REFERENCE_TOO_LARGE");
  }

  return {
    type: "image_url",
    image_url: {
      url: `data:image/jpeg;base64,${preview.toString("base64")}`,
      detail: "auto",
    },
  };
}

function extractAssistantText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const message = choices[0];
  if (!message || typeof message !== "object") return "";
  const content = (message as { message?: { content?: unknown } }).message
    ?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function parseJsonContent(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("INVALID_VISION_OUTPUT");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export async function requestStructuredVision<T>({
  systemPrompt,
  userText,
  images,
  schema,
  maxTokens = 1400,
  logContext,
}: {
  systemPrompt: string;
  userText: string;
  images: VisionImagePart[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  logContext?: ModelCallContext & { operation: string };
}): Promise<T> {
  const config = await getOpusConfig();
  if (!config.enabled || !config.apiKey) {
    throw new Error("VISION_UNAVAILABLE");
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const requestBody = {
    model: config.model,
    reasoning_effort: "low",
    temperature: 0.1,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [{ type: "text", text: userText }, ...images],
      },
    ],
  };
  return withModelCall(
    {
      ...logContext,
      secrets: [config.apiKey],
      kind: "llm",
      operation: logContext?.operation ?? "creative.inspect",
      modelId: config.model,
      providerName: "Opus 5.5",
      endpoint,
      requestContent: requestBody,
    },
    async (call) => {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        timeoutMs: Number(process.env.CREATIVE_VISION_TIMEOUT_MS ?? 30_000),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      call.response(response);
      if (!response.ok)
        throw await providerError(
          response,
          "Opus 5.5",
          "chat-completions",
          endpoint,
        );

      const payload = await response.json();
      call.usage(payload);
      const content = extractAssistantText(payload);
      if (!content.trim()) throw new Error("INVALID_VISION_OUTPUT");
      return schema.parse(parseJsonContent(content));
    },
  );
}
