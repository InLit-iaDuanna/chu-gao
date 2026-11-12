import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    generation: {
      updateMany: vi.fn(),
    },
    providerAccount: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    providerAccountLease: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const db = {
    $transaction: vi.fn(),
    generation: {
      findMany: vi.fn(),
    },
    providerAccount: {
      fields: { maxConcurrency: "max-concurrency-field-ref" },
      findMany: vi.fn(),
    },
    providerAccountLease: {
      findMany: vi.fn(),
    },
  };
  return { db, tx };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/models/registry", () => ({
  getModel: vi.fn(() => ({ protocol: "OPENAI_IMAGES" })),
}));
vi.mock("@/lib/provider-channels", () => ({
  supportsProviderChannels: vi.fn(() => false),
}));
vi.mock("@/lib/providers/availability", () => ({
  providerChannelMatchesBaseUrl: vi.fn(() => true),
  supportedModelIds: vi.fn((modelId: string) => [modelId]),
}));
vi.mock("@/lib/providers/config", () => ({
  providerAccountMaxAttempts: vi.fn(() => 5),
}));
vi.mock("@/lib/providers/protocols", () => ({
  modelProtocolToProviderProtocol: vi.fn(() => "OPENAI_IMAGES"),
}));

import {
  findEligibleProviderAccounts,
  leaseProviderAccount,
  isFallbackProvider,
  releaseAccountLease,
} from "@/lib/providers/account-pool";

const provider = {
  id: "provider-1",
  name: "Provider",
  protocol: "OPENAI_IMAGES",
  baseUrl: "https://example.com/v1",
  apiKeyEnc: "encrypted",
  priority: 100,
  health: "HEALTHY",
  modelsSupported: ["gpt-image-2"],
  costMultiplier: 1,
  selectionStrategy: "LEAST_IN_FLIGHT",
  poolMaxConcurrency: null,
  isActive: true,
  consecutiveErrors: 0,
  lastErrorAt: null,
  lastErrorMsg: null,
  lastHealthyAt: new Date("2026-08-04T07:00:00.000Z"),
  note: null,
  createdAt: new Date("2026-08-04T06:00:00.000Z"),
};

const account = {
  id: "account-1",
  providerId: provider.id,
  name: "Account",
  baseUrl: provider.baseUrl,
  apiKeyEnc: "encrypted",
  apiKeyFingerprint: "fingerprint",
  priority: 100,
  weight: 1,
  maxConcurrency: 1,
  inFlight: 1,
  health: "HEALTHY",
  isActive: true,
  consecutiveErrors: 0,
  lastLeaseAt: null,
  lastHealthyAt: new Date("2026-08-04T07:00:00.000Z"),
  lastErrorAt: null,
  lastErrorMsg: null,
  cooldownUntil: null,
  dailyLimit: null,
  dailyUsed: 0,
  note: null,
  createdAt: new Date("2026-08-04T06:00:00.000Z"),
  updatedAt: new Date("2026-08-04T06:00:00.000Z"),
  provider,
};

const context = {
  generationId: "generation-1",
  userId: "user-1",
  executionToken: "execution-1",
};

describe("provider account leases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(async (callback) =>
      callback(mocks.tx),
    );
    process.env.DATABASE_URL = "postgresql://configured";
  });

  it("increments the account and records an execution lease atomically", async () => {
    mocks.tx.providerAccount.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.tx.generation.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.tx.providerAccountLease.create.mockResolvedValueOnce({
      id: "lease-1",
    });

    const result = await leaseProviderAccount(account as never, context);

    expect(result).toMatchObject({ leaseId: "lease-1", account });
    expect(mocks.tx.providerAccount.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          inFlight: { lt: "max-concurrency-field-ref" },
        }),
        data: expect.objectContaining({ inFlight: { increment: 1 } }),
      }),
    );
    expect(mocks.tx.providerAccountLease.create).toHaveBeenCalledWith({
      data: {
        providerAccountId: account.id,
        generationId: context.generationId,
        executionToken: context.executionToken,
      },
    });
    expect(mocks.tx.generation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });

  it("balances the counter when the generation was superseded", async () => {
    mocks.tx.providerAccount.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.tx.generation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      leaseProviderAccount(account as never, context),
    ).resolves.toBeNull();
    expect(mocks.tx.providerAccountLease.create).not.toHaveBeenCalled();
    expect(mocks.tx.providerAccount.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: account.id, inFlight: { gt: 0 } },
      data: { inFlight: { decrement: 1 } },
    });
  });

  it("releases the same lease at most once", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([{ id: account.id }]);
    mocks.tx.providerAccountLease.findUnique.mockResolvedValue({
      providerAccountId: account.id,
      releasedAt: null,
    });
    mocks.tx.providerAccountLease.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.tx.providerAccountLease.count.mockResolvedValue(0);
    mocks.tx.providerAccount.update.mockResolvedValue({ id: account.id });

    await expect(releaseAccountLease("lease-1")).resolves.toBe(true);
    await expect(releaseAccountLease("lease-1")).resolves.toBe(false);
    expect(mocks.tx.providerAccount.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.providerAccount.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: { inFlight: 0 },
    });
  });

  it("keeps saturated healthy accounts visible to API preflight", async () => {
    mocks.db.providerAccount.findMany.mockResolvedValueOnce([account]);

    const result = await findEligibleProviderAccounts("gpt-image-2");

    expect(result).toEqual([account]);
    const query = mocks.db.providerAccount.findMany.mock.calls[0]?.[0];
    expect(query.where).not.toHaveProperty("inFlight");
  });

  it("keeps the fixed fallback pool last even when its priority is higher", async () => {
    const fallback = {
      ...account,
      id: "fallback",
      providerId: "ldai-fallback",
      provider: {
        ...provider,
        id: "ldai-fallback",
        priority: 10000,
        costMultiplier: 2,
      },
    };
    const markedUpNormal = {
      ...account,
      id: "normal-markup",
      providerId: "normal-markup",
      provider: {
        ...provider,
        id: "normal-markup",
        priority: 200,
        costMultiplier: 2,
      },
    };
    mocks.db.providerAccount.findMany.mockResolvedValueOnce([
      fallback,
      account,
      markedUpNormal,
    ]);
    expect(
      (await findEligibleProviderAccounts("gpt-image-2")).map((row) => row.id),
    ).toEqual([markedUpNormal.id, account.id, fallback.id]);
    expect(isFallbackProvider({ id: "ldai-fallback-copy" })).toBe(false);
  });
});
