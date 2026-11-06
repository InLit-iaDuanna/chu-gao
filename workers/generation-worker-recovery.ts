import { db } from "@/lib/db";
import {
  claimGenerationForRecovery,
  type GenerationRecoveryOutcome,
} from "@/lib/generation-recovery";
import { logger } from "@/lib/logger";
import type { InternalRequest } from "@/lib/models/types";
import {
  generationRequestSchema,
  validateAgainstModel,
} from "@/lib/models/validate";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import { enqueueGeneration, generationJobIsQueued } from "@/lib/queue";

export interface RecoverStuckGenerationsOptions {
  stuckPendingMs: number;
  stuckRunningMs: number;
  stuckMaxAttempts: number;
}

export async function recoverStuckGenerations({
  stuckPendingMs,
  stuckRunningMs,
  stuckMaxAttempts,
}: RecoverStuckGenerationsOptions): Promise<void> {
  const now = Date.now();
  const stuck = await db.generation.findMany({
    where: {
      status: { in: ["PENDING", "RUNNING"] },
      OR: [
        {
          status: "PENDING",
          OR: [
            { heartbeatAt: { lt: new Date(now - stuckPendingMs) } },
            {
              heartbeatAt: null,
              createdAt: { lt: new Date(now - stuckPendingMs) },
            },
          ],
        },
        {
          status: "RUNNING",
          OR: [
            { heartbeatAt: { lt: new Date(now - stuckRunningMs) } },
            {
              heartbeatAt: null,
              startedAt: { lt: new Date(now - stuckRunningMs) },
            },
          ],
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
      deletedAt: true,
      executionToken: true,
      heartbeatAt: true,
      startedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  for (const generation of stuck) {
    try {
      if (generation.status !== "PENDING" && generation.status !== "RUNNING") {
        continue;
      }
      const recoverableSnapshot = {
        id: generation.id,
        userId: generation.userId,
        status: generation.status,
        executionToken: generation.executionToken,
        heartbeatAt: generation.heartbeatAt,
        startedAt: generation.startedAt,
        createdAt: generation.createdAt,
        deletedAt: generation.deletedAt,
      } as const;
      const deleted = generation.deletedAt !== null;

      if (
        !deleted &&
        generation.status === "PENDING" &&
        generation.jobId &&
        (await generationJobIsQueued(generation.jobId))
      ) {
        logger.info(
          { generationId: generation.id, jobId: generation.jobId },
          "Pending generation recovery skipped because its queue job still exists.",
        );
        continue;
      }

      let request: InternalRequest | null = null;
      let outcome: GenerationRecoveryOutcome = deleted
        ? { kind: "cancel", refundReason: "soft_deleted_generation" }
        : { kind: "requeue" };
      let terminalLogMessage: string | null = null;
      let terminalLogContext: { attempts?: number; error?: string } = {};

      if (!deleted && generation.attempts >= stuckMaxAttempts) {
        outcome = {
          kind: "fail",
          errorCode: "STUCK_JOB",
          errorMessage: "任务长时间未完成，已自动终止并退还点数。",
          refundReason: "stuck_generation",
        };
        terminalLogMessage =
          "Stuck generation failed after max recovery attempts.";
        terminalLogContext = { attempts: generation.attempts };
      } else if (!deleted) {
        const parsedRequest = generationRequestSchema.safeParse(
          generation.paramsRaw,
        );

        if (!parsedRequest.success) {
          outcome = {
            kind: "fail",
            errorCode: "STUCK_JOB_INVALID_REQUEST",
            errorMessage: "历史任务参数已不可恢复，已自动终止并退还点数。",
            refundReason: "stuck_generation_invalid_request",
          };
          terminalLogMessage =
            "Stuck generation failed because paramsRaw is invalid.";
        } else {
          try {
            if (
              parsedRequest.data.creative &&
              generation.status === "RUNNING"
            ) {
              outcome = {
                kind: "fail",
                errorCode: "UPSTREAM_RESULT_UNKNOWN",
                errorMessage:
                  "上游生成结果尚未确认，系统未自动重发，已退回本次积分。请联系管理员核查后再决定是否重新生成。",
                refundReason: "creative_submission_unknown",
              };
            } else {
              request = await validateAgainstModel(parsedRequest.data);
              const base = parsedRequest.data.creative?.baseReference;
              if (base?.kind === "source") {
                const image = await db.generatedImage.findFirst({
                  where: {
                    id: base.key,
                    generation: { userId: generation.userId, deletedAt: null },
                  },
                  select: { storageKey: true, mimeType: true },
                });
                if (!image) throw new Error("creative base image unavailable");
                request.referenceImages = [
                  { key: image.storageKey, mimeType: image.mimeType },
                ];
              }
              if (
                parsedRequest.data.creative &&
                JSON.stringify(
                  request.referenceImages?.map((image) => image.key) ?? [],
                ) !== JSON.stringify(generation.referenceImageKeys)
              ) {
                throw new Error("creative reference snapshot changed");
              }
            }
          } catch (error) {
            outcome = {
              kind: "fail",
              errorCode: "STUCK_JOB_UNSUPPORTED_REQUEST",
              errorMessage:
                "任务引用的模型或参数已不可用，已自动终止并退还点数。",
              refundReason: "stuck_generation_unsupported_request",
            };
            terminalLogMessage =
              "Stuck generation failed because the request no longer validates against its model.";
            terminalLogContext = { error: serializeProviderError(error) };
          }
        }
      }

      const recoveryClaim = await claimGenerationForRecovery(
        db,
        recoverableSnapshot,
        undefined,
        { outcome },
      );

      if (!recoveryClaim.claimed) {
        logger.info(
          { generationId: generation.id },
          "Stuck generation recovery skipped because execution changed.",
        );
        continue;
      }

      if (deleted) {
        logger.info(
          { generationId: generation.id, previousStatus: generation.status },
          "Released a stale soft-deleted generation without re-enqueueing it.",
        );
        continue;
      }

      if (outcome.kind === "fail") {
        logger.warn(
          { generationId: generation.id, ...terminalLogContext },
          terminalLogMessage ?? "Stuck generation recovery terminated.",
        );
        continue;
      }

      if (!request) {
        throw new Error("recoverable generation request was not prepared");
      }

      try {
        const jobId = await enqueueGeneration(
          {
            generationId: generation.id,
            userId: generation.userId,
            request,
            estimatedCredits: generation.costCredits,
          },
          {
            jobId: `${generation.id}-recovery-${generation.attempts + 1}`,
          },
        );

        if (jobId !== generation.jobId) {
          await db.generation.update({
            where: { id: generation.id },
            data: { jobId },
          });
        }
      } catch (error) {
        // The row stays PENDING so the next recovery pass retries once the
        // queue is healthy again; a queue outage must not kill the worker.
        logger.error(
          {
            generationId: generation.id,
            error: serializeProviderError(error),
          },
          "Stuck generation re-enqueue failed; will retry on the next recovery pass.",
        );
        continue;
      }

      logger.info(
        { generationId: generation.id, previousStatus: generation.status },
        "Recovered stuck generation into queue.",
      );
    } catch (error) {
      logger.error(
        {
          generationId: generation.id,
          error: serializeProviderError(error),
        },
        "Stuck generation recovery failed unexpectedly; will retry on the next recovery pass.",
      );
    }
  }
}
