import { z } from "zod";

import { getModel } from "@/lib/models/registry";
import { isResolutionAspectRatioSupported } from "@/lib/models/capabilities";
import type {
  AspectRatio,
  ImageBackground,
  InternalRequest,
  OutputFormat,
  Resolution,
} from "@/lib/models/types";
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
  conversationId: z.string().min(1).optional(),
  userMessage: z.string().min(1).max(4000).optional(),
  assistantMessage: z.string().min(1).max(400).optional(),
  modelId: z.string().min(1),
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(4000).optional(),
  aspectRatio: z.string().min(1),
  resolution: z.enum(["1K", "2K", "4K"]).optional(),
  n: z.number().int().min(1),
  seed: z.number().int().optional(),
  outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
  background: z.enum(["auto", "opaque", "transparent"]).optional(),
  outputCompression: z.number().int().min(0).max(100).optional(),
  referenceImageKeys: z.array(z.string().min(1)).max(16).optional(),
  sourceImageIds: z.array(z.string().min(1)).max(4).optional(),
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

export function validateAgainstModel(
  input: GenerationRequestInput,
): InternalRequest {
  const modelId = input.modelId;
  const model = getModel(modelId);

  if (!model) {
    throw new ValidationError("UNKNOWN_MODEL");
  }

  const capabilities = model.capabilities;
  const aspectRatio = input.aspectRatio as AspectRatio;
  const resolution = input.resolution as Resolution | undefined;
  const outputFormat = (input.outputFormat ??
    model.defaults.outputFormat) as OutputFormat;
  const background = (input.background ?? model.defaults.background) as
    | ImageBackground
    | undefined;

  if (!capabilities.aspectRatios.includes(aspectRatio)) {
    throw new UnsupportedParamError(
      `aspectRatio ${aspectRatio} 不被 ${model.id} 支持`,
    );
  }

  if (!resolution) {
    throw new ValidationError("缺少 resolution");
  }

  if (!capabilities.resolutions.includes(resolution)) {
    throw new UnsupportedParamError(`resolution ${resolution} 不被支持`);
  }

  if (
    !isResolutionAspectRatioSupported(capabilities, resolution, aspectRatio)
  ) {
    throw new UnsupportedParamError(
      `${resolution} 不支持 ${aspectRatio} 比例`,
    );
  }

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

  return {
    modelId,
    protocol: model.protocol,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
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
