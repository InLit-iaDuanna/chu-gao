import { Queue } from "bullmq";

import type { InternalRequest } from "@/lib/models/types";
import { assertRedisReady, getRedis } from "@/lib/redis";

let generationQueue: Queue<GenerationJobPayload> | null = null;

const WORKER_HEARTBEAT_KEY = "generation:worker:heartbeat";
const WORKER_HEARTBEAT_TTL_SECONDS = 45;

export interface GenerationJobPayload {
  generationId: string;
  userId: string;
  request: InternalRequest;
  estimatedCredits: number;
}

export function getGenerationQueue(): Queue<GenerationJobPayload> {
  if (!generationQueue) {
    generationQueue = new Queue<GenerationJobPayload>("generation", {
      connection: getRedis(),
      skipMetasUpdate: true,
    });
  }

  return generationQueue;
}

export async function assertGenerationQueueReady(): Promise<void> {
  await assertRedisReady();
  await getGenerationQueue().waitUntilReady();
}

export async function enqueueGeneration(
  payload: GenerationJobPayload,
): Promise<string> {
  await assertGenerationQueueReady();

  const job = await getGenerationQueue().add("generate", payload, {
    attempts: 1,
    jobId: payload.generationId,
    removeOnComplete: 1000,
    removeOnFail: false,
  });

  return job.id ?? payload.generationId;
}

export async function generationQueueStats() {
  await assertGenerationQueueReady();

  const queue = getGenerationQueue();
  const [counts, heartbeat] = await Promise.all([
    queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused",
    ),
    getRedis().get(WORKER_HEARTBEAT_KEY),
  ]);

  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
    paused: counts.paused ?? 0,
    workerOnline: Boolean(heartbeat),
    workerHeartbeatAt: heartbeat,
  };
}

export async function touchGenerationWorkerHeartbeat(): Promise<void> {
  await getRedis().set(
    WORKER_HEARTBEAT_KEY,
    new Date().toISOString(),
    "EX",
    WORKER_HEARTBEAT_TTL_SECONDS,
  );
}

export async function removeGenerationJob(jobId: string): Promise<boolean> {
  const job = await getGenerationQueue().getJob(jobId);

  if (!job) {
    return false;
  }

  await job.remove();
  return true;
}
