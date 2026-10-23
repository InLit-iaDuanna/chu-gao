import { z } from "zod";
import { creativeConfirmationSchema } from "@/lib/creative-brief";

import { isSizeSupported } from "@/lib/models/capabilities";
import type {
  ImageBackground,
  ImageQuality,
  ImageSize,
  InternalRequest,
  ModelDefinition,
  OutputFormat,
  ResponseFormat,
} from "@/lib/models/types";
import {
  aspectRatioForSize,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  resolutionTierForSize,
} from "@/lib/models/options";
import { getConfiguredModel } from "@/lib/models/runtime-config";
import { normalizeProviderChannelIdForModel } from "@/lib/provider-channels";
import { normalizeUploadedReferenceKey } from "@/lib/storage";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class UnsupportedParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedParamError";
  }
}

export const generationRequestSchema = z.object({
  creative: creativeConfirmationSchema.optional(),
  conversationId: z.string().min(1).optional(),
  userMessage: z.string().min(1).max(4000).optional(),
  assistantMessage: z.string().min(1).max(400).optional(),
  modelId: z.string().min(1),
  image2Mode: z.enum(["standard", "high"]).optional(),
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(4000).optional(),
  size: z.enum(IMAGE_SIZE_OPTIONS).optional(),
  quality: z.enum(IMAGE_QUALITY_OPTIONS).optional(),
  n: z.number().int().min(1),
  seed: z.number().int().optional(),
  outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
  background: z.enum(["auto", "opaque", "transparent"]).optional(),
  outputCompression: z.number().int().min(0).max(100).optional(),
  referenceImageKeys: z.array(z.string().min(1)).max(16).optional(),
  sourceImageIds: z.array(z.string().min(1)).max(4).optional(),
  // Ordered sequence of "upload:<key>" | "source:<id>" tokens that the client
  // builds from the UI reference list. The server uses this to reconstruct the
  // exact user-specified reference image order.
  referenceOrder: z.array(z.string().min(1)).max(20).optional(),
  providerChannelId: z.string().trim().min(1).max(200).optional(),
});

export type GenerationRequestInput = z.infer<typeof generationRequestSchema>;

function mimeTypeForReferenceKey(key: string): string {
  const normalized = key.toLowerCase();

  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

export function validateAgainstModelDefinition(
  input: GenerationRequestInput,
  model: ModelDefinition,
): InternalRequest {
  const modelId = input.modelId;
  const capabilities = model.capabilities;

  const size = (input.size ?? model.defaults.size) as ImageSize;
  const quality = (input.quality ??
    model.defaults.quality ??
    "auto") as ImageQuality;
  const responseFormat = model.defaults.responseFormat as ResponseFormat;
  const outputFormat = (input.outputFormat ??
    model.defaults.outputFormat) as OutputFormat;
  const background = (input.background ?? model.defaults.background) as
    | ImageBackground
    | undefined;

  if (!isSizeSupported(model, size)) {
    throw new UnsupportedParamError(`尺寸 ${size} 不被 ${model.id} 支持`);
  }

  const supportedQualities = capabilities.qualities ?? ["auto"];
  if (!supportedQualities.includes(quality)) {
    throw new UnsupportedParamError(`质量 ${quality} 不被 ${model.id} 支持`);
  }

  if (!capabilities.responseFormats.includes(responseFormat)) {
    throw new UnsupportedParamError(`返回格式 ${responseFormat} 不被支持`);
  }

  const resolution = resolutionTierForSize(size);
  const aspectRatio = aspectRatioForSize(size);

  if (input.n > capabilities.maxN) {
    throw new ValidationError(`n 必须在 1 到 ${capabilities.maxN} 之间`);
  }

  if (input.referenceImageKeys?.length) {
    if (!capabilities.supportsReferenceImage) {
      throw new UnsupportedParamError("当前模型不支持参考图");
    }

    if (input.referenceImageKeys.length > capabilities.maxReferenceImages) {
      throw new UnsupportedParamError(
        `参考图最多 ${capabilities.maxReferenceImages} 张`,
      );
    }

    for (const key of input.referenceImageKeys) {
      if (!normalizeUploadedReferenceKey(key)) {
        throw new ValidationError("参考图无效，请重新上传");
      }
    }
  }

  if (input.negativePrompt && !capabilities.supportsNegativePrompt) {
    throw new UnsupportedParamError("当前模型不支持负面提示");
  }

  if (input.seed !== undefined && !capabilities.supportsSeed) {
    throw new UnsupportedParamError("当前模型不支持随机种子");
  }

  if (!capabilities.outputFormats.includes(outputFormat)) {
    throw new UnsupportedParamError("当前模型不支持该输出格式");
  }

  if (!background || !capabilities.backgrounds.includes(background)) {
    throw new UnsupportedParamError("当前模型不支持该背景模式");
  }

  if (
    background === "transparent" &&
    outputFormat !== "png" &&
    outputFormat !== "webp"
  ) {
    throw new UnsupportedParamError("透明背景仅支持 PNG 或 WEBP");
  }

  if (
    input.outputCompression !== undefined &&
    (!capabilities.supportsOutputCompression ||
      (outputFormat !== "jpeg" && outputFormat !== "webp"))
  ) {
    throw new UnsupportedParamError("当前格式不支持压缩率");
  }

  const providerChannelId = normalizeProviderChannelIdForModel(
    modelId,
    input.providerChannelId,
  );

  return {
    executionPolicy: input.creative ? "single-submit" : undefined,
    modelId,
    // Keep the historical pricing axis stable while the public UI uses the
    // upstream-native quality parameter instead.
    image2Mode: modelId === "gpt-image-2" ? "standard" : undefined,
    protocol: model.protocol,
    providerChannelId,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    size,
    quality,
    responseFormat,
    aspectRatio,
    resolution,
    n: input.n,
    seed: input.seed,
    outputFormat,
    background,
    outputCompression: input.outputCompression,
    referenceImages: input.referenceImageKeys?.map((key) => ({
      key: normalizeUploadedReferenceKey(key) as string,
      mimeType: mimeTypeForReferenceKey(key),
    })),
  };
}

export async function validateAgainstModel(
  input: GenerationRequestInput,
): Promise<InternalRequest> {
  const model = await getConfiguredModel(input.modelId);

  if (!model) {
    throw new ValidationError("UNKNOWN_MODEL");
  }

  return validateAgainstModelDefinition(input, model);
}
