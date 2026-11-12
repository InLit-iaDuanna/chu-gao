import type { Prisma } from "@prisma/client";

import { estimateCost, resolvePerImageCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  estimateCostFromSnapshot,
  getModelWithPricing,
  parsePricingSnapshot,
  pricingSnapshotForProvider,
} from "@/lib/model-pricing";
import { resolutionTierForDimensions } from "@/lib/models/options";
import { getConfiguredModel } from "@/lib/models/runtime-config";
import type { InternalRequest } from "@/lib/models/types";
import type { PersistedGeneratedImage } from "@/lib/storage";
import { isFallbackProvider } from "@/lib/providers/account-pool";

export class ProviderCreditsError extends Error {
  constructor() {
    super("点数不足，无法使用备用渠道");
    this.name = "ProviderCreditsError";
  }
}

export async function reserveGenerationProviderCredits({
  generationId,
  userId,
  executionToken,
  request,
  selection,
}: {
  generationId: string;
  userId: string;
  executionToken: string;
  request: InternalRequest;
  selection: {
    providerId: string;
    providerAccountId: string | null;
    baseUrl: string;
  };
}): Promise<void> {
  await db.$transaction(async (tx) => {
    // Lock the execution before inspecting its ledger. Retries, completion,
    // cancellation and recovery all serialize on this same generation row.
    const selected = await tx.generation.updateMany({
      where: {
        id: generationId,
        userId,
        status: "RUNNING",
        executionToken,
        deletedAt: null,
      },
      data: {
        providerId: selection.providerId,
        providerAccountId: selection.providerAccountId,
        heartbeatAt: new Date(),
      },
    });
    if (selected.count === 0) {
      throw new Error("generation execution was superseded before dispatch");
    }
    const generation = await tx.generation.findUniqueOrThrow({
      where: { id: generationId },
      select: { pricingSnapshot: true },
    });
    const snapshot = parsePricingSnapshot(generation.pricingSnapshot);
    if (!snapshot) {
      if (isFallbackProvider({ id: selection.providerId })) {
        throw new Error("Provider pricing was not frozen at submission");
      }
      return;
    }
    const selectedSnapshot = pricingSnapshotForProvider(
      snapshot,
      selection,
      request,
    );
    const requiredCredits = selectedSnapshot.selectedProvider!.reservedCredits;
    const ledger = await tx.usageLog.aggregate({
      where: { generationId, action: { in: ["generate", "refund"] } },
      _sum: { creditsDelta: true },
    });
    const reservedCredits = Math.max(0, -(ledger._sum.creditsDelta ?? 0));
    const extraCredits = Math.max(0, requiredCredits - reservedCredits);
    if (extraCredits > 0) {
      const debited = await tx.user.updateMany({
        where: { id: userId, credits: { gte: extraCredits } },
        data: { credits: { decrement: extraCredits } },
      });
      if (debited.count === 0) throw new ProviderCreditsError();
      await tx.usageLog.create({
        data: {
          userId,
          generationId,
          providerId: selection.providerId,
          providerAccountId: selection.providerAccountId,
          modelId: request.modelId,
          action: "generate",
          creditsDelta: -extraCredits,
          metadata: {
            reason: "provider_reservation",
            multiplier: selectedSnapshot.selectedProvider!.multiplier,
            reservedCredits: requiredCredits,
          },
        },
      });
    }
    await tx.generation.update({
      where: { id: generationId },
      data: {
        pricingSnapshot: selectedSnapshot as unknown as Prisma.InputJsonObject,
        costCredits: Math.max(reservedCredits, requiredCredits),
      },
    });
  });
}

export interface SettleGenerationSuccessInput {
  generationId: string;
  userId: string;
  request: InternalRequest;
  estimatedCredits: number;
  providerId: string;
  providerAccountId: string | null;
  savedImages: PersistedGeneratedImage[];
  /**
   * API-key results handed back in memory instead of being stored. They are
   * billed exactly like saved images but get no GeneratedImage rows.
   */
  ephemeralImages?: { width: number; height: number }[];
  executionToken: string;
}

export interface SettleGenerationFailureInput {
  generationId: string;
  userId: string;
  modelId: string;
  estimatedCredits: number;
  failureCode: string;
  failureMessage: string;
  failureCategory: string;
  executionToken: string;
}

export async function settleGenerationSuccess({
  generationId,
  userId,
  request,
  estimatedCredits,
  providerId,
  providerAccountId,
  savedImages,
  ephemeralImages = [],
  executionToken,
}: SettleGenerationSuccessInput): Promise<boolean> {
  const model = await getConfiguredModel(request.modelId);
  const billedImages: { width: number; height: number }[] = [
    ...savedImages,
    ...ephemeralImages,
  ];
  const successCount = Math.max(billedImages.length, 1);
  const generationSnapshot = await db.generation.findUnique({
    where: { id: generationId },
    select: { pricingSnapshot: true },
  });
  const pricingSnapshot = parsePricingSnapshot(
    generationSnapshot?.pricingSnapshot,
  );
  const actualResolutionTiers =
    request.size === "auto"
      ? billedImages.map((image) =>
          resolutionTierForDimensions(image.width, image.height),
        )
      : undefined;
  // Jobs created by an older web container have no per-tier map in their
  // snapshot. Resolve those legacy auto jobs against the current admin rules
  // so a returned 2K/4K image is not silently charged as 1K.
  const legacyPricingModel =
    actualResolutionTiers?.length &&
    pricingSnapshot &&
    !pricingSnapshot.perImageCreditsByResolution
      ? await getModelWithPricing(request.modelId)
      : null;
  const settlementSnapshot =
    legacyPricingModel && actualResolutionTiers?.length && pricingSnapshot
      ? {
          ...pricingSnapshot,
          perImageCreditsByResolution: Object.fromEntries(
            [...new Set(actualResolutionTiers)].map((resolution) => [
              resolution,
              resolvePerImageCredits(legacyPricingModel, {
                ...request,
                resolution,
                n: 1,
              }).credits,
            ]),
          ),
        }
      : pricingSnapshot;
  const calculatedCredits =
    estimateCostFromSnapshot(
      settlementSnapshot,
      successCount,
      1,
      actualResolutionTiers,
    ) ??
    (model
      ? estimateCost(model, { ...request, n: successCount })
      : estimatedCredits);
  // Older queued requests do not include this optional policy field. Keep the
  // settlement path compatible with those payloads while honoring it when
  // present in newer creative requests.
  const executionPolicy = (
    request as InternalRequest & { executionPolicy?: "single-submit" }
  ).executionPolicy;
  const actualCredits =
    executionPolicy === "single-submit" &&
    !isFallbackProvider({
      id: pricingSnapshot?.selectedProvider?.providerId ?? providerId,
    })
      ? Math.min(calculatedCredits, estimatedCredits)
      : calculatedCredits;
  if (
    isFallbackProvider({ id: providerId }) &&
    (pricingSnapshot?.selectedProvider?.providerId !== providerId ||
      actualCredits > pricingSnapshot.selectedProvider.reservedCredits)
  ) {
    throw new Error("Fallback settlement exceeds its pre-dispatch reservation");
  }

  return db.$transaction(async (tx) => {
    const completed = await tx.generation.updateMany({
      where: {
        id: generationId,
        userId,
        status: "RUNNING",
        executionToken,
      },
      data: {
        status: "SUCCEEDED",
        providerId,
        providerAccountId,
        progress: 100,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
        costCredits: actualCredits,
      },
    });

    if (completed.count === 0) {
      logger.info(
        { generationId },
        "Generation completion skipped because it is no longer running.",
      );
      return false;
    }

    const chargeLog = await tx.usageLog.aggregate({
      where: {
        generationId,
        action: { in: ["generate", "refund"] },
      },
      _sum: {
        creditsDelta: true,
      },
    });
    const alreadyDebited = Math.max(0, -(chargeLog._sum.creditsDelta ?? 0));

    const extraCredits = Math.max(0, actualCredits - alreadyDebited);
    if (extraCredits > 0 && isFallbackProvider({ id: providerId })) {
      throw new Error("Fallback credits were not reserved before dispatch");
    }
    const extraChargeUser =
      extraCredits > 0
        ? await tx.user.updateMany({
            where: { id: userId, credits: { gte: extraCredits } },
            data: { credits: { decrement: extraCredits } },
          })
        : null;
    const settledActualCredits =
      extraCredits > 0 && extraChargeUser?.count === 0
        ? alreadyDebited || estimatedCredits
        : actualCredits;
    const boundedRefundCredits = Math.max(
      0,
      alreadyDebited - settledActualCredits,
    );

    if (settledActualCredits !== actualCredits) {
      await tx.generation.update({
        where: { id: generationId },
        data: { costCredits: settledActualCredits },
      });
    }

    if (savedImages.length > 0)
      await tx.generatedImage.createMany({
        data: savedImages.map((image) => ({
          generationId,
          storageKey: image.storageKey,
          thumbnailKey: image.thumbnailKey,
          width: image.width,
          height: image.height,
          sizeBytes: image.sizeBytes,
          mimeType: image.mimeType,
        })),
      });

    if (boundedRefundCredits > 0) {
      await tx.user.update({
        where: { id: userId },
        data: {
          credits: {
            increment: boundedRefundCredits,
          },
        },
      });

      await tx.usageLog.create({
        data: {
          userId,
          generationId,
          providerId,
          providerAccountId,
          modelId: request.modelId,
          action: "refund",
          creditsDelta: boundedRefundCredits,
          metadata: {
            reason: "successful_image_count",
            estimatedCredits,
            actualCredits,
            chargedCredits: settledActualCredits,
          },
        },
      });
    }

    if (extraCredits > 0 && extraChargeUser?.count) {
      await tx.usageLog.create({
        data: {
          userId,
          generationId,
          providerId,
          providerAccountId,
          modelId: request.modelId,
          action: "generate",
          creditsDelta: -extraCredits,
          metadata: {
            reason: "auto_actual_size",
            estimatedCredits,
            actualCredits,
            chargedCredits: settledActualCredits,
          },
        },
      });
    } else if (extraCredits > 0) {
      await tx.usageLog.create({
        data: {
          userId,
          generationId,
          providerId,
          providerAccountId,
          modelId: request.modelId,
          action: "pricing_adjustment_skipped",
          creditsDelta: 0,
          metadata: {
            reason: "insufficient_balance_for_auto_actual_size",
            estimatedCredits,
            actualCredits,
            chargedCredits: settledActualCredits,
            missingCredits: extraCredits,
          },
        },
      });
    }

    return true;
  });
}

export async function settleGenerationFailure({
  generationId,
  userId,
  modelId,
  estimatedCredits,
  failureCode,
  failureMessage,
  failureCategory,
  executionToken,
}: SettleGenerationFailureInput): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const failed = await tx.generation.updateMany({
      where: {
        id: generationId,
        userId,
        status: "RUNNING",
        executionToken,
      },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        progress: 0,
        errorCode: failureCode,
        errorMessage: failureMessage,
        heartbeatAt: new Date(),
      },
    });

    if (failed.count === 0) {
      logger.info(
        { generationId },
        "Generation failure skipped because it is no longer running.",
      );
      return false;
    }

    const alreadyRefunded = await tx.usageLog.aggregate({
      where: {
        generationId,
        action: "refund",
      },
      _sum: {
        creditsDelta: true,
      },
    });
    const charged = await tx.usageLog.aggregate({
      where: {
        generationId,
        action: "generate",
      },
      _sum: {
        creditsDelta: true,
      },
    });
    const debitedCredits = Math.max(0, -(charged._sum.creditsDelta ?? 0));
    const refundedCredits = Math.max(0, alreadyRefunded._sum.creditsDelta ?? 0);
    const refundableCredits = Math.max(0, debitedCredits - refundedCredits);

    if (refundableCredits > 0) {
      await tx.user.update({
        where: { id: userId },
        data: {
          credits: {
            increment: refundableCredits,
          },
        },
      });

      await tx.usageLog.create({
        data: {
          userId,
          generationId,
          modelId,
          action: "refund",
          creditsDelta: refundableCredits,
          metadata: {
            reason: "generation_failed",
            estimatedCredits,
            failureCategory,
          },
        },
      });
    }

    if (failureCode === "MODERATION_REJECTED") {
      await tx.usageLog.create({
        data: {
          userId,
          generationId,
          modelId,
          action: "moderation_rejected",
          creditsDelta: 0,
          metadata: {
            reason: "provider_content_rejected",
          },
        },
      });
    }

    return true;
  });
}
