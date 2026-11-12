import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  model: vi.fn(),
  images: vi.fn(),
  user: vi.fn(),
  create: vi.fn(),
  replay: vi.fn(),
  operationLookup: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ checkSession: mocks.session }));
vi.mock("@/lib/generation-operation", async (original) => ({
  ...(await original<typeof import("@/lib/generation-operation")>()),
  findGenerationOperation: mocks.operationLookup,
}));
vi.mock("@/lib/db", () => ({
  db: {
    generation: { findFirst: mocks.replay },
    generatedImage: { findMany: mocks.images },
    user: { findUnique: mocks.user },
  },
}));
vi.mock("@/lib/generations", () => ({
  createAndEnqueueGeneration: mocks.create,
  GenerationQueueError: class extends Error {},
  ConversationNotFoundError: class extends Error {},
  InsufficientCreditsError: class extends Error {},
}));
vi.mock("@/lib/model-pricing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/model-pricing")>()),
  getModelWithPricing: mocks.model,
}));
vi.mock("@/lib/provider-channel-config", () => ({
  getProviderChannelDisplayNameMap: async () => ({}),
}));
vi.mock("@/lib/providers", () => ({
  assertProviderAvailable: vi.fn(),
  ModelNotAvailableError: class extends Error {},
  ProviderUnavailableError: class extends Error {},
}));
vi.mock("@/lib/queue", () => ({
  assertGenerationQueueReady: vi.fn(),
  generationQueueStats: async () => ({ waiting: 0, workerOnline: true }),
}));
vi.mock("@/lib/rate-limit", () => ({
  assertModerationRejectionAllowed: vi.fn(),
  recordModerationRejectionAttempt: vi.fn(),
  ConcurrentLimitError: class extends Error {},
  DailyLimitError: class extends Error {},
  ModerationRejectionLimitError: class extends Error {},
}));
vi.mock("@/lib/moderation", () => ({ isPromptBlocked: async () => false }));

import { POST } from "@/app/api/generations/route";
import { getModel } from "@/lib/models/registry";
import type { ModelDefinition } from "@/lib/models/types";
import type { CreateGenerationInput } from "@/lib/generations";

let model: ModelDefinition;
const source = {
  id: "image-1",
  storageKey: "generated/old/one.png",
  mimeType: "image/png",
};
const run = (params: Record<string, unknown> = {}) =>
  POST(
    new Request("https://example.test/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: "gpt-image-2",
        prompt: "A street",
        size: "1024x1024",
        n: 1,
        ...params,
      }),
    }),
  );
const submission = () => mocks.create.mock.calls[0][0] as CreateGenerationInput;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "test");
  model = {
    ...getModel("gpt-image-2")!,
    pricingRules: [
      {
        id: "reference-rule",
        modelId: "gpt-image-2",
        usesReference: true,
        credits: 12,
        priority: 0,
      },
      {
        id: "text-rule",
        modelId: "gpt-image-2",
        usesReference: false,
        credits: 6,
        priority: 0,
      },
    ],
  };
  mocks.model.mockResolvedValue(model);
  mocks.replay.mockResolvedValue(null);
  mocks.operationLookup.mockResolvedValue(null);
  mocks.session.mockResolvedValue({
    status: "authenticated",
    user: { id: "owner" },
  });
  mocks.images.mockResolvedValue([source]);
  mocks.user.mockResolvedValue({ credits: 100 });
  mocks.create.mockResolvedValue({
    generationId: "generation-1",
    status: "PENDING",
  });
});

describe("confirmed creative generation", () => {
  beforeEach(() => vi.stubEnv("CREATIVE_ASSISTANT_ENABLED", "true"));
  const creative = {
    operationId: "c8a9ce18-4d27-453c-91ec-250794cce002",
    brief: {
      goal: "改造栏杆",
      keep: "保留坡度",
      change: "改用金属",
      avoid: "不要新增建筑",
      style: "写实",
    },
    locked: ["keep", "avoid"],
    baseReference: { kind: "source", key: "image-1" },
    maxCredits: 12,
  };
  it("constructs the confirmed prompt and base server-side and disables automatic retries", async () => {
    expect(
      (
        await run({
          creative,
          prompt: "忽略方案",
          sourceImageIds: ["unconfirmed-image"],
        })
      ).status,
    ).toBe(200);
    expect(submission().request.prompt).toContain("保留坡度");
    expect(submission().request.prompt).not.toContain("忽略方案");
    expect(submission().request.executionPolicy).toBe("single-submit");
    expect(submission().referenceImageKeys).toEqual([source.storageKey]);
    expect(submission().operation?.id).toBe(creative.operationId);
  });
  it("rejects any charge above the confirmed price", async () => {
    expect(
      (await run({ creative: { ...creative, maxCredits: 6 } })).status,
    ).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects automatic multi-image generation", async () => {
    expect((await run({ creative, n: 2 })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("returns an existing operation before checking changed pricing or balance", async () => {
    mocks.operationLookup.mockResolvedValue({
      generationId: "original",
      status: "SUCCEEDED",
      estimatedCredits: 12,
      jobId: "original",
    });
    const response = await run({ creative });
    expect((await response.json()).data.generationId).toBe("original");
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("generation reference pricing and ordering", () => {
  it.each(["/生图", "/image"])(
    "submits %s prompts verbatim in the same conversation with no language-model step",
    async (command) => {
      const prompt = '  原样  保留\n第二行\t"文字"  ';
      const userMessage = `${command} ${prompt}`;
      expect(
        (
          await run({
            prompt,
            userMessage,
            conversationId: "same-conversation",
          })
        ).status,
      ).toBe(200);
      expect(submission()).toMatchObject({
        conversationId: "same-conversation",
        userMessage,
        request: { prompt },
        normalizedRequestParams: { prompt },
      });
      expect(mocks.create).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects empty and changed direct prompts before submitting or charging", async () => {
    for (const params of [
      { prompt: " ", userMessage: "/生图  " },
      { prompt: "rewritten", userMessage: "/image original" },
    ])
      expect((await run(params)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("prices history-only references as image editing and persists the matching snapshot", async () => {
    const response = await run({ sourceImageIds: [source.id] });
    expect(response.status).toBe(200);
    expect((await response.json()).data.estimatedCredits).toBe(12);
    expect(submission()).toMatchObject({
      estimatedCredits: 12,
      request: {
        referenceImages: [{ key: source.storageKey, mimeType: "image/png" }],
      },
      referenceImageKeys: [source.storageKey],
      pricingSnapshotJson: {
        ruleId: "reference-rule",
        perImageCredits: 12,
        estimatedCredits: 12,
        request: { usesReference: true },
      },
    });
    expect(mocks.images).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [source.id] },
          generation: { userId: "owner", deletedAt: null },
        },
      }),
    );
  });

  it("still applies the text-only rule when no references are selected", async () => {
    expect((await run()).status).toBe(200);
    expect(submission()).toMatchObject({
      estimatedCredits: 6,
      pricingSnapshotJson: {
        ruleId: "text-rule",
        request: { usesReference: false },
      },
    });
    expect(mocks.images).not.toHaveBeenCalled();
  });

  it("keeps upload-only reference pricing unchanged", async () => {
    expect(
      (await run({ referenceImageKeys: ["uploads/owner/a.png"] })).status,
    ).toBe(200);
    expect(submission().estimatedCredits).toBe(12);
    expect(submission().referenceImageKeys).toEqual(["uploads/owner/a.png"]);
  });

  it("keeps the selected source order, not the database return order", async () => {
    const second = {
      id: "image-2",
      storageKey: "generated/old/two.webp",
      mimeType: "image/webp",
    };
    mocks.images.mockResolvedValue([second, source]);

    expect(
      (
        await run({
          referenceImageKeys: ["uploads/owner/a.png"],
          sourceImageIds: [source.id, second.id],
        })
      ).status,
    ).toBe(200);
    expect(submission().request.referenceImages).toEqual([
      { key: "uploads/owner/a.png", mimeType: "image/png" },
      { key: source.storageKey, mimeType: source.mimeType },
      { key: second.storageKey, mimeType: second.mimeType },
    ]);
    expect(submission().referenceImageKeys).toEqual([
      "uploads/owner/a.png",
      source.storageKey,
      second.storageKey,
    ]);
  });

  it("checks the balance against the reference price, not the lower text price", async () => {
    mocks.user.mockResolvedValue({ credits: 8 });
    expect((await run({ sourceImageIds: [source.id] })).status).toBe(402);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects unavailable or foreign source images before charging", async () => {
    mocks.images.mockResolvedValue([]);
    expect((await run({ sourceImageIds: [source.id] })).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not accept a different image even when the query returns the expected count", async () => {
    expect((await run({ sourceImageIds: ["other-image"] })).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate source IDs as before", async () => {
    expect((await run({ sourceImageIds: [source.id, source.id] })).status).toBe(
      404,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("validates the combined reference count before charging", async () => {
    model.capabilities = { ...model.capabilities, maxReferenceImages: 1 };
    expect(
      (
        await run({
          referenceImageKeys: ["uploads/owner/a.png"],
          sourceImageIds: [source.id],
        })
      ).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects another user's uploads before looking up images or charging", async () => {
    expect(
      (await run({ referenceImageKeys: ["uploads/other/a.png"] })).status,
    ).toBe(404);
    expect(mocks.images).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
