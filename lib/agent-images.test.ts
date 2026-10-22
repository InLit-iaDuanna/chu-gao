import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  replay: vi.fn(),
  model: vi.fn(),
  stat: vi.fn(),
  find: vi.fn(),
  bind: vi.fn(),
  blocked: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { generation: { findFirst: mocks.find } } }));
vi.mock("@/lib/agent-auth", async (original) => ({
  ...(await original<typeof import("@/lib/agent-auth")>()),
  bindAgentRead: mocks.bind,
}));
vi.mock("@/lib/generation-operation", async (original) => ({
  ...(await original<typeof import("@/lib/generation-operation")>()),
  findGenerationOperation: mocks.replay,
}));
vi.mock("@/lib/generations", () => ({
  createAndEnqueueGeneration: mocks.create,
  GenerationQueueError: class extends Error {},
  InsufficientCreditsError: class extends Error {},
}));
vi.mock("@/lib/model-pricing", async (original) => ({
  ...(await original<typeof import("@/lib/model-pricing")>()),
  getModelWithPricing: mocks.model,
}));
vi.mock("@/lib/queue", () => ({ assertGenerationQueueReady: vi.fn() }));
vi.mock("@/lib/providers", () => ({
  assertProviderAvailable: vi.fn(),
  ProviderUnavailableError: class extends Error {},
  ModelNotAvailableError: class extends Error {},
}));
vi.mock("@/lib/moderation", () => ({ isPromptBlocked: mocks.blocked }));
vi.mock("@/lib/rate-limit", () => ({
  assertModerationRejectionAllowed: vi.fn(),
  recordModerationRejectionAttempt: vi.fn(),
  ConcurrentLimitError: class extends Error {},
  DailyLimitError: class extends Error {},
  ModerationRejectionLimitError: class extends Error {},
}));
vi.mock("@/lib/storage", () => ({
  normalizeUploadedReferenceKey: (key: string) => key,
  statPrivateStorageKey: mocks.stat,
}));
import {
  agentGenerationSchema,
  ownedAgentGeneration,
  publicAgentFailure,
  submitAgentGeneration,
} from "@/lib/agent-images";
import { getModel } from "@/lib/models/registry";
import type { AgentPrincipal } from "@/lib/agent-auth";

const principal = {
  user: { id: "owner", email: "owner@test.local", credits: 100 },
  authorization: { id: "grant" },
} as AgentPrincipal;
const body = {
  modelId: "gpt-image-2",
  prompt: "A quiet street",
  size: "1024x1024",
  n: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.replay.mockResolvedValue(null);
  mocks.model.mockResolvedValue({
    ...getModel("gpt-image-2")!,
    pricingRules: [
      { id: "normal", modelId: "gpt-image-2", credits: 6, priority: 0 },
      {
        id: "reference",
        modelId: "gpt-image-2",
        usesReference: true,
        credits: 9,
        priority: 2,
      },
    ],
  });
  mocks.create.mockResolvedValue({
    generationId: "job",
    status: "PENDING",
    estimatedCredits: 6,
  });
  mocks.stat.mockResolvedValue({ size: 42 });
  mocks.blocked.mockResolvedValue(false);
});
describe("Agent image service", () => {
  it("shares pricing and the existing transactional queue submission", async () => {
    await submitAgentGeneration(principal, body, "operation-1");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner",
        agentAuthorizationId: "grant",
        estimatedCredits: 6,
        operation: expect.objectContaining({ id: "agent:operation-1" }),
      }),
    );
    expect(mocks.create.mock.calls[0][0].request.responseFormat).toBe(
      "b64_json",
    );
  });
  it("preserves reference order and reference pricing", async () => {
    const referenceImageKeys = [
      "uploads/owner/two.png",
      "uploads/owner/one.png",
    ];
    await submitAgentGeneration(
      principal,
      { ...body, referenceImageKeys },
      "operation-2",
    );
    const submitted = mocks.create.mock.calls[0][0];
    expect(
      submitted.request.referenceImages.map(
        (image: { key: string }) => image.key,
      ),
    ).toEqual(referenceImageKeys);
    expect(submitted.estimatedCredits).toBe(9);
  });
  it("rejects hidden channel fields and cross-user reference images before charging", async () => {
    expect(
      agentGenerationSchema.safeParse({
        ...body,
        providerChannelId: "secret-channel",
      }).success,
    ).toBe(false);
    await expect(
      submitAgentGeneration(
        principal,
        { ...body, referenceImageKeys: ["uploads/other/one.png"] },
        "operation-3",
      ),
    ).rejects.toThrow("参考图不存在");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires an operation identifier and stops on moderation failures", async () => {
    await expect(submitAgentGeneration(principal, body, null)).rejects.toThrow(
      "Idempotency-Key",
    );
    mocks.blocked.mockResolvedValue(true);
    await expect(
      submitAgentGeneration(principal, body, "operation-4"),
    ).rejects.toThrow("内容审核");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not bind a grant to another user's image or a website-only task", async () => {
    mocks.find.mockResolvedValue(null);
    await expect(
      ownedAgentGeneration(principal, "another-job"),
    ).rejects.toThrow("任务不存在");
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "another-job",
          userId: "owner",
          OR: [
            { agentAuthorizationId: { not: null } },
            { apiKeyId: { not: null } },
          ],
          deletedAt: null,
        },
      }),
    );
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("maps stored errors to customer messages without upstream content", () => {
    expect(publicAgentFailure("MODERATION_REJECTED")).toContain("内容审核");
    expect(publicAgentFailure("PROVIDER_ERROR")).not.toMatch(
      /https:|Provider|account/i,
    );
  });
});
