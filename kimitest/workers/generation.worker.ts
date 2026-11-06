import { Worker } from "bullmq";
import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ProviderUnavailableError, selectAndGenerate } from "@/lib/providers";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import {
  touchGenerationWorkerHeartbeat,
  type GenerationJobPayload,
} from "@/lib/queue";
import { assertRedisReady, getRedis } from "@/lib/redis";
import {
  hydrateReferenceImages,
  removePersistedGeneratedImages,
  saveGeneratedImage,
  type PersistedGeneratedImage,
} from "@/lib/storage";
import {
  generationFailureCode,
  usageFailureCategory,
  userFacingGenerationError,
} from "./generation-worker-errors";
import { recoverStuckGenerations } from "./generation-worker-recovery";
import {
  settleGenerationFailure,
  settleGenerationSuccess,
} from "./generation-worker-settlement";

const STUCK_PENDING_MS = Number(process.env.STUCK_PENDING_MS ?? 2 * 60_000);
const STUCK_RUNNING_MS = Number(process.env.STUCK_RUNNING_MS ?? 10 * 60_000);
const STUCK_MAX_ATTEMPTS = Number(process.env.STUCK_MAX_ATTEMPTS ?? 3);
const WORKER_HEARTBEAT_INTERVAL_MS = Number(
  process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 15_000,
);

function clampProgress(value?: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Set it in .env, run `docker compose up -d postgres redis`, then `pnpm db:migrate && pnpm db:seed`.",
    );
  }

  await db.$queryRaw`SELECT 1`;
  await touchGenerationWorkerHeartbeat();
  await recoverStuckGenerations({
    stuckPendingMs: STUCK_PENDING_MS,
    stuckRunningMs: STUCK_RUNNING_MS,
    stuckMaxAttempts: STUCK_MAX_ATTEMPTS,
  });

  const redis = getRedis();
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
      const executionToken = randomUUID();
      const claimedAt = new Date();

      const claimed = await db.generation.updateMany({
        where: {
          id: generationId,
          userId,
          status: "PENDING",
        },
        data: {
          status: "RUNNING",
          progress: 0,
          startedAt: claimedAt,
          heartbeatAt: claimedAt,
          executionToken,
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

      const executionHeartbeat = setInterval(() => {
        db.generation
          .updateMany({
            where: {
              id: generationId,
              userId,
              status: "RUNNING",
              executionToken,
            },
            data: { heartbeatAt: new Date() },
          })
          .catch((error) => {
            logger.warn(
              { generationId, error: serializeProviderError(error) },
              "Generation execution heartbeat failed.",
            );
          });
      }, WORKER_HEARTBEAT_INTERVAL_MS);
      const savedImages: PersistedGeneratedImage[] = [];
      let imagesCommitted = false;

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
        } = await selectAndGenerate(hydratedRequest, {
          onProviderSelected: async (selection) => {
            selectedProviderId = selection.providerId;
            selectedProviderAccountId = selection.providerAccountId;
            await db.generation.updateMany({
              where: {
                id: generationId,
                userId,
                status: "RUNNING",
                executionToken,
              },
              data: {
                providerId: selection.providerId,
                providerAccountId: selection.providerAccountId,
                heartbeatAt: new Date(),
              },
            });
          },
          onProgress: async (event) => {
            const progress = clampProgress(event.progress);
            await db.generation.updateMany({
              where: {
                id: generationId,
                userId,
                status: "RUNNING",
                executionToken,
              },
              data: {
                progress,
                providerId: selectedProviderId,
                providerAccountId: selectedProviderAccountId,
                heartbeatAt: new Date(),
              },
            });
          },
        });

        if (result.images.length === 0) {
          throw new Error("provider returned no images");
        }

        for (const [index, image] of result.images.entries()) {
          savedImages.push(
            await saveGeneratedImage(
              image,
              generationId,
              index,
              executionToken,
            ),
          );
        }
        imagesCommitted = await settleGenerationSuccess({
          generationId,
          userId,
          request,
          estimatedCredits,
          providerId,
          providerAccountId,
          savedImages,
          executionToken,
        });

        if (!imagesCommitted) {
          throw new Error("generation execution was superseded");
        }

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
        if (!imagesCommitted && savedImages.length > 0) {
          try {
            await removePersistedGeneratedImages(savedImages);
          } catch (cleanupError) {
            logger.error(
              {
                generationId,
                error: serializeProviderError(cleanupError),
              },
              "Generation file cleanup failed.",
            );
          }
        }

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

        await settleGenerationFailure({
          generationId,
          userId,
          modelId: request.modelId,
          estimatedCredits,
          failureCode,
          failureMessage,
          failureCategory,
          executionToken,
        });

        throw new Error(failureMessage);
      } finally {
        clearInterval(executionHeartbeat);
      }
    },
    {
      connection: redis,
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
  }, WORKER_HEARTBEAT_INTERVAL_MS);

  worker.on("error", (error) => {
    logger.error(
      { error: serializeProviderError(error) },
      "Generation worker queue connection error.",
    );
  });

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

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(heartbeat);
    logger.info({ signal }, "Generation worker shutting down.");

    try {
      await worker.close();
    } finally {
      redis.disconnect();
      await db.$disconnect();
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  logger.info("Generation worker started.");
}

assertRedisReady()
  .then(main)
  .catch((error) => {
    logger.error(
      { error: serializeProviderError(error) },
      "Generation worker failed to start.",
    );
    process.exit(1);
  });
