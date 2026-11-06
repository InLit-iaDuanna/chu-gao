import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enqueue: vi.fn(),
  client: null as unknown,
  model: null as unknown,
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.client;
  },
}));
vi.mock("@/lib/queue", () => ({
  enqueueGeneration: state.enqueue,
  assertGenerationQueueReady: vi.fn(),
}));
vi.mock("@/lib/providers", () => ({
  assertProviderAvailable: vi.fn(),
  ModelNotAvailableError: class extends Error {},
  ProviderUnavailableError: class extends Error {},
}));
vi.mock("@/lib/moderation", () => ({ isPromptBlocked: async () => false }));
vi.mock("@/lib/models/runtime-config", () => ({
  getConfiguredModel: async () => state.model,
  listConfiguredModels: async () => [state.model],
}));
vi.mock("@/lib/model-pricing", async (original) => ({
  ...(await original<typeof import("@/lib/model-pricing")>()),
  getModelWithPricing: async () => state.model,
}));
vi.mock("@/lib/chat-turns", () => ({ assertChatConversationIdle: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  normalizeUploadedReferenceKey: (key: string) => key,
  statPrivateStorageKey: async () => ({ size: 8 }),
  privateImageUrl: () => "",
  privateImageThumbnailUrl: () => "",
  readPrivateStorageKey: async () => Buffer.from("test-image"),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import {
  createDeviceAuthorization,
  decideDeviceAuthorization,
  exchangeDeviceCode,
  requireAgent,
  secretHash,
} from "@/lib/agent-auth";
import {
  submitAgentGeneration,
  ownedAgentGeneration,
} from "@/lib/agent-images";
import { getModel } from "@/lib/models/registry";
import {
  settleGenerationFailure,
  settleGenerationSuccess,
} from "@/workers/generation-worker-settlement";
import { revokeAgentAuthorization } from "@/lib/agent-browser";
import { GET as imageResult } from "@/app/api/v1/generations/[id]/images/[imageId]/route";
import { checkSession } from "@/lib/auth";

const databaseUrl = process.env.AGENT_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !/^\/chugao_agent_it_[a-z0-9_]+$/.test(url.pathname)
  )
    throw new Error(
      "Agent integration tests require a local scratch database.",
    );
}
const client = enabled
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] })
  : null;
state.client = client;
let userId: string;
const base = {
  modelId: "gpt-image-2",
  prompt: "A quiet street",
  size: "auto",
  n: 1,
};

async function authorize(mode = "timed") {
  const code = await createDeviceAuthorization(
    new Request("http://127.0.0.1:3001/api/agent/device-authorization"),
    "Integration Agent",
  );
  await decideDeviceAuthorization({
    userCode: code.user_code,
    userId,
    sessionVersion: 1,
    decision: "approve",
    mode,
    durationHours: 2,
  });
  const result = await exchangeDeviceCode(code.device_code);
  if (!result.access_token) throw new Error("No integration token issued");
  const request = new Request("http://127.0.0.1:3001/api/v1/models", {
    headers: { Authorization: `Bearer ${result.access_token}` },
  });
  return {
    principal: await requireAgent(request),
    request,
    token: result.access_token,
  };
}

describe.skipIf(!enabled)(
  "Agent access with PostgreSQL and a simulated provider",
  () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      state.model = {
        ...getModel("gpt-image-2")!,
        costTable: { "1K": 6, "2K": 9, "4K": 15 },
        pricingRules: [],
      };
      const user = await client!.user.create({
        data: {
          email: `agent-${randomUUID()}@test.invalid`,
          passwordHash: "unused",
          credits: 100,
          dailyGenLimit: 100,
          concurrentLimit: 10,
        },
      });
      userId = user.id;
      state.enqueue.mockImplementation(
        async ({ generationId }) => generationId,
      );
    });
    afterAll(async () => {
      await client?.$disconnect();
    });

    it("concurrent retries create one job and debit once", async () => {
      const { principal } = await authorize("single");
      const [a, b] = await Promise.all([
        submitAgentGeneration(principal, base, "same-operation"),
        submitAgentGeneration(principal, base, "same-operation"),
      ]);
      expect(a.generationId).toBe(b.generationId);
      expect(await client!.generation.count({ where: { userId } })).toBe(1);
      expect(
        (await client!.user.findUniqueOrThrow({ where: { id: userId } }))
          .credits,
      ).toBe(94);
      expect(state.enqueue).toHaveBeenCalledOnce();
      await expect(
        submitAgentGeneration(
          principal,
          { ...base, prompt: "different" },
          "same-operation",
        ),
      ).rejects.toThrow();
    });
    it("two concurrent single-task submissions cannot charge for two jobs", async () => {
      const { principal } = await authorize("single");
      const results = await Promise.allSettled([
        submitAgentGeneration(principal, base, "operation-one"),
        submitAgentGeneration(principal, base, "operation-two"),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(await client!.generation.count({ where: { userId } })).toBe(1);
      expect(
        (await client!.user.findUniqueOrThrow({ where: { id: userId } }))
          .credits,
      ).toBe(94);
    });
    it("expires and revokes credentials immediately, preserves jobs, and recovers them with renewed consent", async () => {
      const auth = await authorize("single");
      const submitted = await submitAgentGeneration(
        auth.principal,
        base,
        "recover-operation",
      );
      await client!.agentAuthorization.update({
        where: { id: auth.principal.authorization.id },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      await expect(requireAgent(auth.request)).rejects.toThrow(
        "已到期或已撤销",
      );
      const renewed = await authorize("single");
      expect(
        (await ownedAgentGeneration(renewed.principal, submitted.generationId))
          .id,
      ).toBe(submitted.generationId);
      await expect(
        submitAgentGeneration(renewed.principal, base, "different-operation"),
      ).rejects.toThrow("已用于一个任务");
      await revokeAgentAuthorization(
        userId,
        renewed.principal.authorization.id,
      );
      await expect(requireAgent(renewed.request)).rejects.toThrow(
        "已到期或已撤销",
      );
      expect(await client!.generation.count({ where: { userId } })).toBe(1);
      expect(
        (await client!.user.findUniqueOrThrow({ where: { id: userId } }))
          .credits,
      ).toBe(94);
    });
    it("settles auto by returned dimensions and returns Base64 through the owned image endpoint", async () => {
      const auth = await authorize();
      const submitted = await submitAgentGeneration(
        auth.principal,
        base,
        "auto-operation",
      );
      const { request } = state.enqueue.mock.calls[0][0];
      const provider = await client!.provider.create({
        data: {
          name: "Test private upstream",
          protocol: "OPENAI_IMAGES",
          baseUrl: "https://private-upstream.invalid",
          apiKeyEnc: "not-a-real-key",
          modelsSupported: [base.modelId],
        },
      });
      await client!.generation.update({
        where: { id: submitted.generationId },
        data: { status: "RUNNING", executionToken: "lease" },
      });
      await settleGenerationSuccess({
        generationId: submitted.generationId,
        userId,
        request,
        estimatedCredits: 6,
        executionToken: "lease",
        providerId: provider.id,
        providerAccountId: null,
        savedImages: [
          {
            storageKey: "generated/test.png",
            width: 2048,
            height: 2048,
            sizeBytes: 10,
            mimeType: "image/png",
          },
        ],
      });
      expect(
        (await client!.user.findUniqueOrThrow({ where: { id: userId } }))
          .credits,
      ).toBe(91);
      const image = await client!.generatedImage.findFirstOrThrow({
        where: { generationId: submitted.generationId },
      });
      const response = await imageResult(auth.request, {
        params: Promise.resolve({
          id: submitted.generationId,
          imageId: image.id,
        }),
      });
      const result = await response.json();
      expect(Buffer.from(result.data.b64_json, "base64").toString()).toBe(
        "test-image",
      );
      expect(JSON.stringify(result)).not.toContain("private-upstream");
    });
    it("refunds a provider failure once and never resubmits a failed operation", async () => {
      const { principal } = await authorize();
      const submitted = await submitAgentGeneration(
        principal,
        base,
        "failed-operation",
      );
      await client!.generation.update({
        where: { id: submitted.generationId },
        data: { status: "RUNNING", executionToken: "lease" },
      });
      const failure = {
        generationId: submitted.generationId,
        userId,
        modelId: base.modelId,
        estimatedCredits: 6,
        executionToken: "lease",
        failureCode: "PROVIDER_ERROR",
        failureMessage: "private upstream details",
        failureCategory: "upstream",
      };
      await settleGenerationFailure(failure);
      await settleGenerationFailure(failure);
      const replay = await submitAgentGeneration(
        principal,
        base,
        "failed-operation",
      );
      expect(replay.status).toBe("FAILED");
      expect(
        (await client!.user.findUniqueOrThrow({ where: { id: userId } }))
          .credits,
      ).toBe(100);
      expect(
        await client!.usageLog.count({ where: { userId, action: "refund" } }),
      ).toBe(1);
      expect(state.enqueue).toHaveBeenCalledOnce();
    });
    it("rejects other users, banned accounts and bearer access to the website session", async () => {
      const auth = await authorize();
      const job = await submitAgentGeneration(
        auth.principal,
        base,
        "owned-operation",
      );
      const oldUser = userId;
      userId = (
        await client!.user.create({
          data: {
            email: `other-${randomUUID()}@test.invalid`,
            passwordHash: "unused",
          },
        })
      ).id;
      const other = await authorize();
      await expect(
        ownedAgentGeneration(other.principal, job.generationId),
      ).rejects.toThrow("任务不存在");
      await client!.user.update({
        where: { id: oldUser },
        data: { status: "BANNED" },
      });
      await expect(requireAgent(auth.request)).rejects.toThrow(
        "已到期或已撤销",
      );
      expect(await checkSession(other.request)).toMatchObject({
        status: "unauthenticated",
      });
      expect(
        (
          await client!.agentAuthorization.findUniqueOrThrow({
            where: { id: other.principal.authorization.id },
          })
        ).tokenHash,
      ).toBe(secretHash(other.token));
    });
  },
);
