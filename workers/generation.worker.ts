import { Worker } from "bullmq";

import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  estimateCostFromSnapshot,
  parsePricingSnapshot,
} from "@/lib/model-pricing";
import { getConfiguredModel } from "@/lib/models/runtime-config";
import {
  generationRequestSchema,
  validateAgainstModel,
} from "@/lib/models/validate";
import { ProviderUnavailableError, selectAndGenerate } from "@/lib/providers";
import {
  classifyProviderFailure,
  serializeProviderError,
} from "@/lib/providers/diagnostics";
import {
  enqueueGeneration,
  touchGenerationWorkerHeartbeat,
  type GenerationJobPayload,
} from "@/lib/queue";
import { assertRedisReady, getRedis } from "@/lib/redis";
import { hydrateReferenceImages, saveGeneratedImage } from "@/lib/storage";

const STUCK_PENDING_MS = Number(process.env.STUCK_PENDING_MS ?? 2 * 60_000);
const STUCK_RUNNING_MS = Number(process.env.STUCK_RUNNING_MS ?? 10 * 60_000);
const STUCK_MAX_ATTEMPTS = Number(process.env.STUCK_MAX_ATTEMPTS ?? 3);

function clampProgress(value?: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

function userFacingGenerationError(error: unknown): string {
  const { category } = classifyProviderFailure(error);

  if (category === "CONTENT_REJECTED") {
    return "提示词或参考图包含不允许的内容，请调整后再试。";
  }

  if (category === "BAD_REQUEST") {
    return "生成请求被渠道拒绝，请调整提示词、参考图或参数后再试。";
  }

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

function generationFailureCode(error: unknown): string {
  const { category } = classifyProviderFailure(error);

  if (category === "CONTENT_REJECTED") {
    return "MODERATION_REJECTED";
  }

  if (category === "BAD_REQUEST") {
    return "PROVIDER_REJECTED_REQUEST";
  }

  return "PROVIDER_ERROR";
}

function usageFailureCategory(error: unknown): string {
  const { category } = classifyProviderFailure(error);

  if (category === "CONTENT_REJECTED") {
    return "moderation";
  }

  if (category === "BAD_REQUEST") {
    return "request";
  }

  return "provider";
}

async function refundGeneration(
  generationId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const refunded = await tx.usageLog.aggregate({
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
    const refundedCredits = Math.max(0, refunded._sum.creditsDelta ?? 0);
    const refundableCredits = Math.max(0, debitedCredits - refundedCredits);

    if (refundableCredits === 0) {
      return;
    }

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
        action: "refund",
        creditsDelta: refundableCredits,
        metadata: {
          reason,
        },
      },
    });
  });
}

async function markGenerationFailedAndRefund(
  generationId: string,
  userId: string,
  errorCode: string,
  errorMessage: string,
  reason: string,
): Promise<void> {
  const failed = await db.generation.updateMany({
    where: {
      id: generationId,
      userId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorCode,
      errorMessage,
    },
  });

  if (failed.count > 0) {
    await refundGeneration(generationId, userId, reason);
  }
}

async function recoverStuckGenerations(): Promise<void> {
  const now = Date.now();
  const stuck = await db.generation.findMany({
    where: {
      deletedAt: null,
      status: { in: ["PENDING", "RUNNING"] },
      OR: [
        {
          status: "PENDING",
          createdAt: { lt: new Date(now - STUCK_PENDING_MS) },
        },
        {
          status: "RUNNING",
          startedAt: { lt: new Date(now - STUCK_RUNNING_MS) },
        },
      ],
    },
    take: 100,
    select: {
      id: true,
      userId: true,
      status: true,
      attempts: true,
      modelId: true,
      prompt: true,
      negativePrompt: true,
      aspectRatio: true,
      resolution: true,
      n: true,
      outputFormat: true,
      paramsRaw: true,
      referenceImageKeys: true,
      costCredits: true,
      jobId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  for (const generation of stuck) {
    if (generation.attempts >= STUCK_MAX_ATTEMPTS) {
      await markGenerationFailedAndRefund(
        generation.id,
        generation.userId,
        "STUCK_JOB",
        "任务长时间未完成，已自动终止并退还点数。",
        "stuck_generation",
      );
      logger.warn(
        { generationId: generation.id, attempts: generation.attempts },
        "Stuck generation failed after max recovery attempts.",
      );
      continue;
    }

    const parsedRequest = generationRequestSchema.safeParse(
      generation.paramsRaw,
    );

    if (!parsedRequest.success) {
      await markGenerationFailedAndRefund(
        generation.id,
        generation.userId,
        "STUCK_JOB_INVALID_REQUEST",
        "历史任务参数已不可恢复，已自动终止并退还点数。",
        "stuck_generation_invalid_request",
      );
      logger.warn(
        { generationId: generation.id },
        "Stuck generation failed because paramsRaw is invalid.",
      );
      continue;
    }

    const request = await validateAgainstModel(parsedRequest.data);

    await db.generation.update({
      where: { id: generation.id },
      data: {
        status: "PENDING",
        progress: 0,
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });

    const jobId = await enqueueGeneration({
      generationId: generation.id,
      userId: generation.userId,
      request,
      estimatedCredits: generation.costCredits,
    });

    if (jobId !== generation.jobId) {
      await db.generation.update({
        where: { id: generation.id },
        data: { jobId },
      });
    }

    logger.info(
      { generationId: generation.id, previousStatus: generation.status },
      "Recovered stuck generation into queue.",
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Set it in .env, run `docker compose up -d postgres redis`, then `pnpm db:push && pnpm db:seed`.",
    );
  }

  await db.$queryRaw`SELECT 1`;
  await touchGenerationWorkerHeartbeat();
  await recoverStuckGenerations();

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
          progress: 0,
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
        let selectedProviderId: string | null = null;
        let selectedProviderAccountId: string | null = null;
        const {
          result,
          providerId,
          providerName,
          providerAccountId,
          providerAccountName,
          multiplier,
        } = await selectAndGenerate(hydratedRequest, {
          onProviderSelected: async (selection) => {
            selectedProviderId = selection.providerId;
            selectedProviderAccountId = selection.providerAccountId;
            await db.generation.updateMany({
              where: {
                id: generationId,
                userId,
                status: { in: ["PENDING", "RUNNING"] },
              },
              data: {
                providerId: selection.providerId,
                providerAccountId: selection.providerAccountId,
              },
            });
          },
          onProgress: async (event) => {
            const progress = clampProgress(event.progress);
            const status = event.status === "queued" ? "PENDING" : "RUNNING";

            await db.generation.updateMany({
              where: {
                id: generationId,
                userId,
                status: { in: ["PENDING", "RUNNING"] },
              },
              data: {
                status,
                progress,
                providerId: selectedProviderId,
                providerAccountId: selectedProviderAccountId,
              },
            });
          },
        });

        if (result.images.length === 0) {
          throw new Error("provider returned no images");
        }

        const savedImages = await Promise.all(
          result.images.map((image, index) =>
            saveGeneratedImage(image, generationId, index),
          ),
        );
        const model = await getConfiguredModel(request.modelId);
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
              status: { in: ["PENDING", "RUNNING"] },
            },
            data: {
              status: "SUCCEEDED",
              providerId,
              providerAccountId,
              progress: 100,
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
                  reason: "provider_multiplier",
                  estimatedCredits,
                  actualCredits,
                  chargedCredits: boundedActualCredits,
                },
              },
            });
          }
        });

        logger.info(
          {
            generationId,
            providerId,
            providerName,
            providerAccountId,
            providerAccountName,
          },
          "Generation completed.",
        );
      } catch (error) {
        const internalDiagnostic = serializeProviderError(error);
        const failureCode = generationFailureCode(error);
        const failureCategory = usageFailureCategory(error);
        const failureMessage = userFacingGenerationError(error);

        logger.error(
          {
            generationId,
            error: internalDiagnostic,
            providerAttempts:
              error instanceof ProviderUnavailableError
                ? error.details?.accountAttempts
                : undefined,
            providerMaxAttempts:
              error instanceof ProviderUnavailableError
                ? error.details?.maxAccountAttempts
                : undefined,
          },
          "Generation provider failed.",
        );

        await db.$transaction(async (tx) => {
          const failed = await tx.generation.updateMany({
            where: {
              id: generationId,
              userId,
              status: { in: ["PENDING", "RUNNING"] },
            },
            data: {
              status: "FAILED",
              finishedAt: new Date(),
              progress: 0,
              errorCode: failureCode,
              errorMessage: failureMessage,
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
                modelId: request.modelId,
                action: "moderation_rejected",
                creditsDelta: 0,
                metadata: {
                  reason: "provider_content_rejected",
                },
              },
            });
          }
        });

        throw new Error(failureMessage);
      }
    },
    {
      connection: getRedis(),
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    },
  );

  const heartbeat = setInterval(() => {
    touchGenerationWorkerHeartbeat().catch((error) => {
      logger.warn(
        { error: serializeProviderError(error) },
        "Generation worker heartbeat failed.",
      );
    });
  }, 15_000);

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, error: serializeProviderError(error) },
      "Generation job failed.",
    );
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Generation job completed.");
  });

  worker.on("closed", () => {
    clearInterval(heartbeat);
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
