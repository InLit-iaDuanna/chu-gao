import type { Prisma } from "@prisma/client";

type GenerationCapacityClient = Pick<Prisma.TransactionClient, "generation">;

export interface DelayableGenerationJob {
  token?: string;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

export interface GenerationExecutionContext {
  generationId: string;
  userId: string;
  executionToken: string;
}

export function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// The worker should run as many jobs at once as the channel pool can lease,
// so the concurrency set on the channel page is the real site-wide limit.
export function workerConcurrencyTarget(
  totalAccountSlots: number,
  bounds: { min: number; max: number },
): number {
  if (!Number.isFinite(totalAccountSlots)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(totalAccountSlots)));
}

export async function activeProviderAccountSlots(
  client: Pick<Prisma.TransactionClient, "providerAccount">,
): Promise<number> {
  const result = await client.providerAccount.aggregate({
    where: { isActive: true, provider: { isActive: true } },
    _sum: { maxConcurrency: true },
  });
  return result._sum.maxConcurrency ?? 0;
}

export function providerCapacityRetryDelay(
  configuredMs: number,
  random: () => number = Math.random,
): number {
  const base = positiveInteger(configuredMs, 1_500);
  const jitter = Math.min(500, Math.floor(base / 3));
  return base + Math.floor(random() * (jitter + 1));
}

export async function delayGenerationForProviderCapacity(
  client: GenerationCapacityClient,
  job: DelayableGenerationJob,
  context: GenerationExecutionContext,
  options: {
    configuredRetryMs: number;
    lockToken?: string;
    now?: () => number;
    random?: () => number;
  },
): Promise<{ delayed: boolean; retryDelay: number }> {
  const nowMs = (options.now ?? Date.now)();
  const reset = await client.generation.updateMany({
    where: {
      id: context.generationId,
      userId: context.userId,
      status: "RUNNING",
      executionToken: context.executionToken,
      deletedAt: null,
    },
    data: {
      status: "PENDING",
      progress: 0,
      providerId: null,
      providerAccountId: null,
      executionToken: null,
      // PENDING recovery uses this as the latest known queue activity, so a
      // legitimate delayed retry is not mistaken for an abandoned job.
      heartbeatAt: new Date(nowMs),
      startedAt: null,
      attempts: { decrement: 1 },
    },
  });

  if (reset.count === 0) {
    return { delayed: false, retryDelay: 0 };
  }

  const retryDelay = providerCapacityRetryDelay(
    options.configuredRetryMs,
    options.random,
  );
  await job.moveToDelayed(nowMs + retryDelay, options.lockToken ?? job.token);
  return { delayed: true, retryDelay };
}
