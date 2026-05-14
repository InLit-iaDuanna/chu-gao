import type { Prisma } from "@prisma/client";

import { publicChannelAlias } from "@/lib/channel-alias";
import {
  getImage2ProviderChannelName,
  resolveImage2ProviderChannelId,
} from "@/lib/provider-channels";
import { privateImageUrl } from "@/lib/storage";

export const GENERATION_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const;

export type GenerationStatusFilter = (typeof GENERATION_STATUSES)[number];

export type GenerationWithRelations = Prisma.GenerationGetPayload<{
  include: {
    images: true;
    provider: {
      select: {
        id: true;
        name: true;
      };
    };
    providerAccount: {
      select: {
        id: true;
        name: true;
        baseUrl: true;
      };
    };
  };
}>;

export function isGenerationStatus(
  value: string | null,
): value is GenerationStatusFilter {
  return Boolean(
    value && GENERATION_STATUSES.includes(value as GenerationStatusFilter),
  );
}

export function serializeGeneration(row: GenerationWithRelations) {
  const images = row.images.map((image) => ({
    id: image.id,
    url: privateImageUrl(row.id, image.id),
    src: privateImageUrl(row.id, image.id),
    width: image.width,
    height: image.height,
    mimeType: image.mimeType,
    createdAt: image.createdAt,
  }));

  return {
    id: row.id,
    conversationId: row.conversationId,
    modelId: row.modelId,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    n: row.n,
    outputFormat: row.outputFormat,
    referenceImageKeys: row.referenceImageKeys,
    status: row.status,
    provider: row.provider?.name ?? null,
    providerChannelId: resolveImage2ProviderChannelId(
      row.modelId,
      row.paramsRaw,
      row.providerAccount?.baseUrl,
    ),
    providerChannelName: getImage2ProviderChannelName(
      resolveImage2ProviderChannelId(
        row.modelId,
        row.paramsRaw,
        row.providerAccount?.baseUrl,
      ),
    ),
    providerAccountName: publicChannelAlias(
      row.providerAccount?.name,
      row.provider?.name,
      row.providerAccount?.baseUrl,
    ),
    progress: row.progress,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    credits: row.costCredits,
    costCredits: row.costCredits,
    attempts: row.attempts,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    images,
  };
}

export function serializeAdminGeneration(row: GenerationWithRelations) {
  const generation = serializeGeneration(row);

  return {
    ...generation,
    providerId: row.providerId,
    jobId: row.jobId,
    images: generation.images.map((image, index) => ({
      ...image,
      storageKey: row.images[index]?.storageKey,
    })),
  };
}
