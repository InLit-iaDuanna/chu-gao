import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    generation: { findUnique: mocks.snapshot },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/models/runtime-config", () => ({
  getConfiguredModel: async () => null,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn() } }));
import { settleGenerationSuccess } from "@/workers/generation-worker-settlement";
import type { SettleGenerationSuccessInput } from "@/workers/generation-worker-settlement";
const input: SettleGenerationSuccessInput = {
  generationId: "g",
  userId: "u",
  executionToken: "e",
  estimatedCredits: 6,
  providerId: "p",
  providerAccountId: null,
  request: {
    modelId: "gpt-image-2",
    protocol: "openai-images",
    prompt: "test",
    size: "auto",
    quality: "auto",
    responseFormat: "b64_json",
    aspectRatio: "1:1",
    resolution: "1K",
    n: 1,
    outputFormat: "png",
    background: "auto",
    executionPolicy: "single-submit",
  },
  savedImages: [
    {
      storageKey: "generated/a.png",
      width: 1024,
      height: 1024,
      sizeBytes: 100,
      mimeType: "image/png",
    },
  ],
};
const tx = {
  generation: { updateMany: vi.fn(), update: vi.fn() },
  user: { updateMany: vi.fn(), update: vi.fn() },
  usageLog: { aggregate: vi.fn(), create: vi.fn() },
  generatedImage: { createMany: vi.fn() },
};
beforeEach(() => {
  vi.resetAllMocks();
  tx.generation.updateMany.mockResolvedValue({ count: 1 });
  tx.usageLog.aggregate.mockResolvedValue({ _sum: { creditsDelta: -6 } });
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
});
describe("confirmed assisted spending limit", () => {
  it("never charges beyond the accepted amount", async () => {
    mocks.snapshot.mockResolvedValue({
      pricingSnapshot: {
        modelId: "gpt-image-2",
        perImageCredits: 20,
        estimatedCredits: 6,
      },
    });
    await settleGenerationSuccess(input);
    expect(tx.generation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ costCredits: 6 }),
      }),
    );
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.usageLog.create).not.toHaveBeenCalled();
  });
  it("still refunds when the settlement is below the accepted amount", async () => {
    mocks.snapshot.mockResolvedValue({
      pricingSnapshot: {
        modelId: "gpt-image-2",
        perImageCredits: 3,
        estimatedCredits: 6,
      },
    });
    await settleGenerationSuccess(input);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u" },
      data: { credits: { increment: 3 } },
    });
  });
});
