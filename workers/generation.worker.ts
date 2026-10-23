import { DelayedError, Worker } from "bullmq";
import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { startChatWorker } from "@/lib/chat-worker";
import {
  closeChatRuntimeHealth,
  withChatRuntimeTimeout,
} from "@/lib/chat-runtime-health";
import {
  activeProviderAccountSlots,
  delayGenerationForProviderCapacity,
  positiveInteger,
  workerConcurrencyTarget,
} from "@/lib/generation-capacity";
import { logger } from "@/lib/logger";
import {
  ProviderCapacityError,
  ProviderUnavailableError,
  selectAndGenerate,
} from "@/lib/providers";
import {
  reconcileProviderAccountCounters,
  releaseOrphanedProviderLeases,
} from "@/lib/providers/account-pool";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import {
  touchGenerationWorkerHeartbeat,
  type GenerationJobPayload,
} from "@/lib/queue";
import {
  discardApiGenerationImages,
  stashApiGenerationImages,
} from "@/lib/api-image-cache";
import { assertRedisReady, getRedis } from "@/lib/redis";
import {
  hydrateReferenceImages,
  removePersistedGeneratedImages,
  materializeGeneratedImage,
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
const STUCK_RECOVERY_INTERVAL_MS = Number(
  process.env.STUCK_RECOVERY_INTERVAL_MS ?? 60_000,
);
const WORKER_HEARTBEAT_INTERVAL_MS = Number(
  process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 15_000,
);
const CONCURRENCY_SYNC_INTERVAL_MS = 30_000;
const WORKER_CONCURRENCY_BOUNDS = {
  min: positiveInteger(Number(process.env.WORKER_CONCURRENCY_MIN ?? 4), 4),
  max: positiveInteger(Number(process.env.WORKER_CONCURRENCY_MAX ?? 64), 64),
};
const PROVIDER_CAPACITY_RETRY_MS = Number(
  process.env.PROVIDER_CAPACITY_RETRY_MS ?? 1_500,
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
  const stopChatWorker = startChatWorker();
  const runRecoveryPass = async () => {
    await recoverStuckGenerations({
      stuckPendingMs: STUCK_PENDING_MS,
      stuckRunningMs: STUCK_RUNNING_MS,
      stuckMaxAttempts: STUCK_MAX_ATTEMPTS,
    });
    const releasedLeases = await releaseOrphanedProviderLeases();
    const correctedAccounts = await reconcileProviderAccountCounters();
    if (releasedLeases > 0) {
      logger.warn(
        { releasedLeases },
        "Released provider leases left behind by completed executions.",
      );
    }
    if (correctedAccounts > 0) {
      logger.warn(
        { correctedAccounts },
        "Reconciled provider account concurrency counters.",
      );
    }
  };

  await runRecoveryPass();

  const recoveryTimer = setInterval(() => {
    runRecoveryPass().catch((error) => {
      logger.error(
        { error: serializeProviderError(error) },
        "Periodic stuck generation recovery failed.",
      );
    });
  }, STUCK_RECOVERY_INTERVAL_MS);

  const redis = getRedis();
  const worker = new Worker<GenerationJobPayload>(
    "generation",
    async (job, token) => {
      if (!process.env.DATABASE_URL) {
        logger.info(
          { jobId: job.id },
          "Generation worker ran without DATABASE_URL.",
        );
        return;
      }

      const { generationId, userId, request, estimatedCredits } = job.data;
      const executionToken = randomUUID();
      const leaseContext = { generationId, userId, executionToken };
      const claimedAt = new Date();

      const claimed = await db.generation.updateMany({
        where: {
          id: generationId,
          userId,
          status: "PENDING",
          deletedAt: null,
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
      // API-key jobs return their images to the caller and keep nothing on
      // the server; their bytes are only parked in Redis until picked up.
      const isApiKeyJob = Boolean(
        (
          await db.generation.findUnique({
            where: { id: generationId },
            select: { apiKeyId: true },
          })
        )?.apiKeyId,
      );
      let stashedImageCount = 0;
      let imagesCommitted = false;
      let selectedProviderId: string | null = null;
      let selectedProviderAccountId: string | null = null;

      try {
        const hydratedRequest = {
          ...request,
          referenceImages: await hydrateReferenceImages(
            request.referenceImages,
          ),
        };
        const {
          result,
          providerId,
          providerName,
          providerAccountId,
          providerAccountName,
        } = await selectAndGenerate(hydratedRequest, {
          leaseContext,
          onProviderSelected: async (selection) => {
            selectedProviderId = selection.providerId;
            selectedProviderAccountId = selection.providerAccountId;
            const selected = await db.generation.updateMany({
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
            if (selected.count === 0)
              throw new Error(
                "generation execution was superseded before dispatch",
              );
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

        const outputImages =
          request.executionPolicy === "single-submit"
            ? result.images.slice(0, 1)
            : result.images;
        const ephemeralImages = isApiKeyJob
          ? await Promise.all(outputImages.map(materializeGeneratedImage))
          : [];
        if (isApiKeyJob) {
          await stashApiGenerationImages(generationId, ephemeralImages);
          stashedImageCount = ephemeralImages.length;
        } else {
          for (const [index, image] of outputImages.entries()) {
            savedImages.push(
              await saveGeneratedImage(
                image,
                generationId,
                index,
                executionToken,
              ),
            );
          }
        }
        imagesCommitted = await settleGenerationSuccess({
          generationId,
          userId,
          request,
          estimatedCredits,
          providerId,
          providerAccountId,
          savedImages,
          ephemeralImages: ephemeralImages.map(({ width, height }) => ({
            width,
            height,
          })),
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
        if (error instanceof ProviderCapacityError) {
          const capacityRetry = await delayGenerationForProviderCapacity(
            db,
            job,
            leaseContext,
            {
              configuredRetryMs: PROVIDER_CAPACITY_RETRY_MS,
              lockToken: token,
            },
          );

          if (!capacityRetry.delayed) {
            logger.info(
              { generationId },
              "Capacity retry skipped because the execution was superseded.",
            );
            return;
          }

          logger.info(
            { generationId, retryDelay: capacityRetry.retryDelay },
            "Provider pool is saturated; generation moved back to delayed queue.",
          );
          throw new DelayedError();
        }

        if (!imagesCommitted && stashedImageCount > 0) {
          await discardApiGenerationImages(
            generationId,
            stashedImageCount,
          ).catch((cleanupError) => {
            logger.warn(
              { generationId, error: serializeProviderError(cleanupError) },
              "API generation image discard failed; it will expire on its own.",
            );
          });
        }

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
      concurrency: positiveInteger(
        Number(process.env.WORKER_CONCURRENCY ?? 4),
        4,
      ),
    },
  );

  const syncConcurrency = async () => {
    try {
      const slots = await activeProviderAccountSlots(db);
      const target = workerConcurrencyTarget(slots, WORKER_CONCURRENCY_BOUNDS);
      if (worker.concurrency !== target) {
        logger.info(
          { from: worker.concurrency, to: target, slots },
          "Generation worker concurrency synced to channel capacity.",
        );
        worker.concurrency = target;
      }
    } catch (error) {
      logger.warn(
        { error: serializeProviderError(error) },
        "Generation worker concurrency sync failed.",
      );
    }
  };
  void syncConcurrency();
  const concurrencyTimer = setInterval(
    () => void syncConcurrency(),
    CONCURRENCY_SYNC_INTERVAL_MS,
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
    clearInterval(recoveryTimer);
    clearInterval(concurrencyTimer);
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(heartbeat);
    clearInterval(recoveryTimer);
    clearInterval(concurrencyTimer);
    logger.info({ signal }, "Generation worker shutting down.");
    const deadline = setTimeout(() => process.exit(1), 25_000);

    try {
      if (!(await stopChatWorker())) process.exitCode = 1;
      await withChatRuntimeTimeout(() => worker.close(), 10_000);
    } catch {
      process.exitCode = 1;
      logger.warn(
        "Generation worker shutdown deadline reached; unfinished work will be recovered.",
      );
    } finally {
      redis.disconnect();
      closeChatRuntimeHealth();
      await withChatRuntimeTimeout(() => db.$disconnect(), 3_000).catch(
        () => undefined,
      );
      clearTimeout(deadline);
      process.exit(process.exitCode ?? 0);
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
