import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  claim: vi.fn(),
  image: vi.fn(),
  enqueue: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    generation: { findMany: mocks.find, update: mocks.update },
    generatedImage: { findFirst: mocks.image },
  },
}));
vi.mock("@/lib/generation-recovery", () => ({
  claimGenerationForRecovery: mocks.claim,
}));
vi.mock("@/lib/queue", () => ({
  generationJobIsQueued: async () => false,
  enqueueGeneration: mocks.enqueue,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/models/runtime-config", async () => {
  const { getModel } = await import("@/lib/models/registry");
  return { getConfiguredModel: async (id: string) => getModel(id) };
});
import { recoverStuckGenerations } from "@/workers/generation-worker-recovery";
const row = {
  id: "generation-1",
  userId: "owner",
  status: "RUNNING",
  executionToken: "execution",
  heartbeatAt: new Date(0),
  startedAt: new Date(0),
  createdAt: new Date(0),
  deletedAt: null,
  attempts: 1,
  costCredits: 6,
  jobId: "job",
  referenceImageKeys: ["generated/base.png"],
  paramsRaw: {
    modelId: "gpt-image-2",
    n: 1,
    prompt: "Test",
    size: "1024x1024",
    sourceImageIds: ["base"],
    creative: {
      operationId: "c8a9ce18-4d27-453c-91ec-250794cce002",
      brief: {
        goal: "改造栏杆",
        keep: "保留坡度",
        change: "",
        avoid: "",
        style: "",
      },
      locked: ["keep"],
      baseReference: { kind: "source", key: "base" },
      maxCredits: 6,
    },
  },
};
const run = () =>
  recoverStuckGenerations({
    stuckPendingMs: 1,
    stuckRunningMs: 1,
    stuckMaxAttempts: 3,
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue([row]);
  mocks.claim.mockResolvedValue({ claimed: true, releasedLeases: 0 });
  mocks.image.mockResolvedValue({
    storageKey: "generated/base.png",
    mimeType: "image/png",
  });
  mocks.enqueue.mockResolvedValue("recovered-job");
});
describe("assisted recovery safety", () => {
  it("does not resubmit a stale running operation with unknown upstream outcome", async () => {
    await run();
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      {
        outcome: expect.objectContaining({
          kind: "fail",
          errorCode: "UPSTREAM_RESULT_UNKNOWN",
        }),
      },
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("recovers a never-running pending operation with its exact base image", async () => {
    mocks.find.mockResolvedValue([
      { ...row, status: "PENDING", attempts: 0, executionToken: null },
    ]);
    await run();
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          executionPolicy: "single-submit",
          referenceImages: [
            { key: "generated/base.png", mimeType: "image/png" },
          ],
        }),
      }),
      expect.anything(),
    );
  });
  it("does not silently remove a missing base image", async () => {
    mocks.find.mockResolvedValue([{ ...row, status: "PENDING", attempts: 0 }]);
    mocks.image.mockResolvedValue(null);
    await run();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      { outcome: expect.objectContaining({ kind: "fail" }) },
    );
  });
});
