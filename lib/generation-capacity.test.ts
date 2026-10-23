import { describe, expect, it, vi } from "vitest";

import {
  delayGenerationForProviderCapacity,
  positiveInteger,
  providerCapacityRetryDelay,
  workerConcurrencyTarget,
} from "@/lib/generation-capacity";

describe("generation capacity retry", () => {
  it("moves a saturated generation to delayed without consuming an attempt", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const moveToDelayed = vi.fn(async () => undefined);
    const now = new Date("2026-08-04T08:00:00.000Z").getTime();

    const result = await delayGenerationForProviderCapacity(
      { generation: { updateMany } } as never,
      { token: "job-token", moveToDelayed },
      {
        generationId: "generation-1",
        userId: "user-1",
        executionToken: "execution-1",
      },
      {
        configuredRetryMs: 1_500,
        lockToken: "worker-token",
        now: () => now,
        random: () => 0,
      },
    );

    expect(result).toEqual({ delayed: true, retryDelay: 1_500 });
    expect(moveToDelayed).toHaveBeenCalledWith(now + 1_500, "worker-token");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
        data: expect.objectContaining({
          status: "PENDING",
          heartbeatAt: new Date(now),
          attempts: { decrement: 1 },
        }),
      }),
    );
  });

  it("does not delay a generation whose execution was superseded", async () => {
    const moveToDelayed = vi.fn(async () => undefined);
    const result = await delayGenerationForProviderCapacity(
      {
        generation: {
          updateMany: vi.fn(async () => ({ count: 0 })),
        },
      } as never,
      { moveToDelayed },
      {
        generationId: "generation-1",
        userId: "user-1",
        executionToken: "old-token",
      },
      { configuredRetryMs: 1_500 },
    );

    expect(result).toEqual({ delayed: false, retryDelay: 0 });
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  it("uses bounded jitter and rejects invalid worker concurrency values", () => {
    expect(providerCapacityRetryDelay(1_500, () => 0.999)).toBe(2_000);
    expect(providerCapacityRetryDelay(0, () => 0)).toBe(1_500);
    expect(positiveInteger(Number.NaN, 4)).toBe(4);
    expect(positiveInteger(-1, 4)).toBe(4);
    expect(positiveInteger(8, 4)).toBe(8);
  });
});

describe("worker concurrency target", () => {
  it("follows the total channel account slots", () => {
    expect(workerConcurrencyTarget(150, { min: 4, max: 256 })).toBe(150);
  });

  it("clamps to the configured floor and ceiling", () => {
    expect(workerConcurrencyTarget(0, { min: 4, max: 256 })).toBe(4);
    expect(workerConcurrencyTarget(5000, { min: 4, max: 256 })).toBe(256);
  });

  it("falls back to the floor for invalid totals", () => {
    expect(workerConcurrencyTarget(Number.NaN, { min: 4, max: 256 })).toBe(4);
  });
});
