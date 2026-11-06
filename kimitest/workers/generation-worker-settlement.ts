import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  estimateCostFromSnapshot,
  parsePricingSnapshot,
} from "@/lib/model-pricing";
import { getConfiguredModel } from "@/lib/models/runtime-config";
import type { InternalRequest } from "@/lib/models/types";
import type { PersistedGeneratedImage } from "@/lib/storage";

export interface SettleGenerationSuccessInput {
  generationId: string;
  userId: string;
  request: InternalRequest;
  estimatedCredits: number;
  providerId: string;
  providerAccountId: string | null;
  savedImages: PersistedGeneratedImage[];
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
  executionToken,
}: SettleGenerationSuccessInput): Promise<boolean> {
  const model = await getConfiguredModel(request.modelId);
  const successCount = Math.max(savedImages.length, 1);
  const generationSnapshot = await db.generation.findUnique({
    where: { id: generationId },
    select: { pricingSnapshot: true },
  });
  const pricingSnapshot = parsePricingSnapshot(
    generationSnapshot?.pricingSnapshot,
  );
  const actualCredits =
    estimateCostFromSnapshot(pricingSnapshot, successCount) ??
    (model
      ? estimateCost(model, { ...request, n: successCount })
      : estimatedCredits);

  return db.$transaction(async (tx) => {
    const chargeLog = await tx.usageLog.aggregate({
      where: {
        generationId,
        action: "generate",
      },
      _sum: {
        creditsDelta: true,
      },
    });
    const alreadyDebited = Math.max(0, -(chargeLog._sum.creditsDelta ?? 0));

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

    const extraCredits = Math.max(0, actualCredits - alreadyDebited);
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
