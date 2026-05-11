import { Worker } from "bullmq";

import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  estimateCostFromSnapshot,
  parsePricingSnapshot,
} from "@/lib/model-pricing";
import { getModel } from "@/lib/models/registry";
import { selectAndGenerate } from "@/lib/providers";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import type { GenerationJobPayload } from "@/lib/queue";
import { assertRedisReady, getRedis } from "@/lib/redis";
import { hydrateReferenceImages, saveGeneratedImage } from "@/lib/storage";

function userFacingGenerationError(error: unknown): string {
  const message = serializeProviderError(error);

  if (message.includes("provider returned no images")) {
    return "渠道没有返回图片，请稍后重试或更换模型。";
  }

  if (
    message.includes("invalid reference image key") ||
    message.includes("ENOENT")
  ) {
    return "参考图不可用，请重新上传后再试。";
  }

  return "渠道生成失败，请稍后重试或联系管理员检查渠道状态。";
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Set it in .env, run `docker compose up -d postgres redis`, then `pnpm db:push && pnpm db:seed`.",
    );
  }

  await db.$queryRaw`SELECT 1`;

  const worker = new Worker<GenerationJobPayload>(
    "generation",
    async (job) => {
      if (!process.env.DATABASE_URL) {
        logger.info(
          { jobId: job.id },
          "Generation worker ran without DATABASE_URL.",
        );
        return;
      }

      const { generationId, userId, request, estimatedCredits } = job.data;

      const claimed = await db.generation.updateMany({
        where: {
          id: generationId,
          userId,
          status: "PENDING",
        },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          attempts: {
            increment: 1,
          },
        },
      });

      if (claimed.count === 0) {
        logger.info(
          { generationId },
          "Generation job skipped because it is no longer pending.",
        );
        return;
      }

      try {
        const hydratedRequest = {
          ...request,
          referenceImages: await hydrateReferenceImages(
            request.referenceImages,
          ),
        };
        const { result, providerId, providerAccountId, multiplier } =
          await selectAndGenerate(hydratedRequest);

        if (result.images.length === 0) {
          throw new Error("provider returned no images");
        }

        const savedImages = await Promise.all(
          result.images.map((image, index) =>
            saveGeneratedImage(image, generationId, index),
          ),
        );
        const model = getModel(request.modelId);
        const successCount = Math.max(savedImages.length, 1);
        const generationSnapshot = await db.generation.findUnique({
          where: { id: generationId },
          select: { pricingSnapshot: true },
        });
        const actualCredits =
          estimateCostFromSnapshot(
            parsePricingSnapshot(generationSnapshot?.pricingSnapshot),
            successCount,
            multiplier,
          ) ??
          (model
            ? estimateCost(
                model,
                { n: successCount, resolution: request.resolution },
                multiplier,
              )
            : estimatedCredits);

        await db.$transaction(async (tx) => {
          const chargeLog = await tx.usageLog.aggregate({
            where: {
              generationId,
              action: "generate",
            },
            _sum: {
              creditsDelta: true,
            },
          });
          const alreadyDebited = Math.max(
            0,
            -(chargeLog._sum.creditsDelta ?? 0),
          );
          const boundedActualCredits = Math.min(
            actualCredits,
            alreadyDebited || estimatedCredits,
          );
          const boundedRefundCredits = Math.max(
            0,
            alreadyDebited - boundedActualCredits,
          );

          const completed = await tx.generation.updateMany({
            where: {
              id: generationId,
              userId,
              status: "RUNNING",
            },
            data: {
              status: "SUCCEEDED",
              providerId,
              providerAccountId,
              finishedAt: new Date(),
              costCredits: boundedActualCredits,
            },
          });

          if (completed.count === 0) {
            logger.info(
              { generationId },
              "Generation completion skipped because it is no longer running.",
            );
            return;
          }

          await tx.generatedImage.createMany({
            data: savedImages.map((image) => ({
              generationId,
              storageKey: image.storageKey,
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
                  reason: "provider_multiplier",
                  estimatedCredits,
                  actualCredits,
                  chargedCredits: boundedActualCredits,
                },
              },
            });
          }
        });

        logger.info({ generationId, providerId }, "Generation completed.");
      } catch (error) {
        const internalDiagnostic = serializeProviderError(error);

        logger.error(
          { generationId, error: internalDiagnostic },
          "Generation provider failed.",
        );

        await db.$transaction(async (tx) => {
          const failed = await tx.generation.updateMany({
            where: {
              id: generationId,
              userId,
              status: "RUNNING",
            },
            data: {
              status: "FAILED",
              finishedAt: new Date(),
              errorCode: "PROVIDER_ERROR",
              errorMessage: userFacingGenerationError(error),
            },
          });

          if (failed.count === 0) {
            logger.info(
              { generationId },
              "Generation failure skipped because it is no longer running.",
            );
            return;
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
          const refundedCredits = Math.max(
            0,
            alreadyRefunded._sum.creditsDelta ?? 0,
          );
          const refundableCredits = Math.max(
            0,
            debitedCredits - refundedCredits,
          );

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
                modelId: request.modelId,
                action: "refund",
                creditsDelta: refundableCredits,
                metadata: {
                  reason: "generation_failed",
                  estimatedCredits,
                  failureCategory: "provider",
                },
              },
            });
          }
        });

        throw new Error(userFacingGenerationError(error));
      }
    },
    {
      connection: getRedis(),
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, error: serializeProviderError(error) },
      "Generation job failed.",
    );
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Generation job completed.");
  });

  logger.info("Generation worker started.");
}

assertRedisReady()
  .then(main)
  .catch((error) => {
    logger.error(
      { error: serializeProviderError(error) },
      "Generation worker failed to start.",
    );
    process.exitCode = 1;
  });
