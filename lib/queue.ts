import { Queue } from "bullmq";

import type { InternalRequest } from "@/lib/models/types";
import { assertRedisReady, getRedis } from "@/lib/redis";

let generationQueue: Queue<GenerationJobPayload> | null = null;

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

export async function removeGenerationJob(jobId: string): Promise<boolean> {
  const job = await getGenerationQueue().getJob(jobId);

  if (!job) {
    return false;
  }

  await job.remove();
  return true;
}
