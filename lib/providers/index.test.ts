import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    provider: { findMany: vi.fn() },
    providerAccount: { count: vi.fn() },
  },
  findEligibleProviderAccounts: vi.fn(),
  leaseProviderAccount: vi.fn(),
  maxAttemptsForAccounts: vi.fn((accounts: unknown[]) => Math.min(1, accounts.length)),
  releaseAccountLease: vi.fn(),
  providerSupportsGif: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn((value) => value) }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/models/registry", () => ({
  getModel: vi.fn(() => ({ protocol: "OPENAI_IMAGES" })),
}));
vi.mock("@/lib/provider-channels", () => ({
  supportsProviderChannels: vi.fn(() => true),
  displayNameForProviderChannel: vi.fn(() => "Test channel"),
  getImage2ProviderChannel: vi.fn(() => ({ displayName: "Test channel" })),
}));
vi.mock("@/lib/provider-channel-request-config", () => ({
  providerSupportsGif: mocks.providerSupportsGif,
}));
vi.mock("@/lib/model-call-log", () => ({
  withModelCall: vi.fn((_input, run) => run()),
}));
vi.mock("@/lib/providers/channel-circuit-breaker", () => ({
  isChannelCircuitOpen: vi.fn(() => false),
  resetChannelCircuit: vi.fn(),
  tripChannelCircuit: vi.fn(),
}));
vi.mock("@/lib/providers/account-pool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/account-pool")>()),
  findEligibleProviderAccounts: mocks.findEligibleProviderAccounts,
  leaseProviderAccount: mocks.leaseProviderAccount,
  maxAttemptsForAccounts: mocks.maxAttemptsForAccounts,
  releaseAccountLease: mocks.releaseAccountLease,
}));
vi.mock("@/lib/providers/availability", () => ({
  providerChannelMatchesBaseUrl: vi.fn(() => true),
  supportedModelIds: vi.fn((modelId: string) => [modelId]),
}));
vi.mock("@/lib/providers/config", () => ({
  generationTimeoutMs: vi.fn(() => 10_000),
}));
vi.mock("@/lib/providers/diagnostics", () => ({
  serializeProviderError: vi.fn((error) => String(error)),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/lib/providers/factory", () => ({ buildAdapter: vi.fn() }));
vi.mock("@/lib/providers/failure-policy", () => ({
  isDowngradable: vi.fn(() => false),
  isFatalAccountError: vi.fn(() => false),
  providerRejectedError: vi.fn(() => null),
  shouldRecordProviderPoolError: vi.fn(() => false),
}));
vi.mock("@/lib/providers/health", () => ({
  markAccountErrored: vi.fn(),
  markAccountHealthy: vi.fn(),
  markProviderErrored: vi.fn(),
  markProviderHealthy: vi.fn(),
  markProviderPoolErrored: vi.fn(),
}));
vi.mock("@/lib/providers/protocols", () => ({
  modelProtocolToProviderProtocol: vi.fn(() => "OPENAI_IMAGES"),
  providerProtocolToModelProtocol: vi.fn(() => "OPENAI_IMAGES"),
}));

import {
  ModelNotAvailableError,
  ProviderCapacityError,
  ProviderUnavailableError,
  assertProviderAvailable,
  selectAndGenerate,
} from "@/lib/providers";
import { buildAdapter } from "@/lib/providers/factory";
import { isDowngradable } from "@/lib/providers/failure-policy";
import { ProviderSubmissionUnknownError } from "@/lib/providers/single-submit";
import {
  markAccountHealthy,
  markAccountErrored,
  markProviderHealthy,
} from "@/lib/providers/health";

const provider = {
  id: "provider-1",
  name: "Provider",
  protocol: "OPENAI_IMAGES",
  priority: 100,
  costMultiplier: 1,
  baseUrl: "https://normal.test/v1",
  apiKeyEnc: "encrypted",
};
const saturatedAccount = {
  id: "account-1",
  providerId: provider.id,
  baseUrl: "https://example.com/v1",
  provider,
  maxConcurrency: 1,
  inFlight: 0,
};
const request = {
  modelId: "gpt-image-2",
  providerChannelId: "channel-1",
  prompt: "test",
  aspectRatio: "1:1",
  n: 1,
  outputFormat: "png",
  protocol: "OPENAI_IMAGES",
};

describe("provider saturation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://configured";
    mocks.db.provider.findMany.mockResolvedValue([]);
    mocks.findEligibleProviderAccounts.mockResolvedValue([saturatedAccount]);
    mocks.leaseProviderAccount.mockResolvedValue(null);
    mocks.maxAttemptsForAccounts.mockReturnValue(1);
    vi.mocked(isDowngradable).mockReturnValue(false);
  });

  it("classifies a full healthy pool as retryable capacity", async () => {
    await expect(
      selectAndGenerate(request as never, {
        leaseContext: {
          generationId: "generation-1",
          userId: "user-1",
          executionToken: "execution-1",
        },
      }),
    ).rejects.toBeInstanceOf(ProviderCapacityError);
  });

  it("does not reject API preflight merely because all slots are busy", async () => {
    await expect(
      assertProviderAvailable(request.modelId, request.providerChannelId),
    ).resolves.toBeUndefined();
  });

  it("still rejects when no configured provider exists", async () => {
    mocks.findEligibleProviderAccounts.mockResolvedValue([]);

    await expect(
      selectAndGenerate(request as never, {
        leaseContext: {
          generationId: "generation-1",
          userId: "user-1",
          executionToken: "execution-1",
        },
      }),
    ).rejects.toBeInstanceOf(ModelNotAvailableError);
  });
  it("does not switch accounts after an ambiguous assisted submission", async () => {
    mocks.findEligibleProviderAccounts.mockResolvedValue([
      saturatedAccount,
      { ...saturatedAccount, id: "account-2" },
    ]);
    mocks.maxAttemptsForAccounts.mockReturnValue(2);
    mocks.leaseProviderAccount.mockResolvedValue({
      account: { ...saturatedAccount, apiKeyEnc: "key" },
      provider,
      leaseId: "lease-1",
    });
    vi.mocked(isDowngradable).mockReturnValueOnce(true);
    const generate = vi
      .fn()
      .mockRejectedValue(new TypeError("connection lost"));
    vi.mocked(buildAdapter).mockReturnValue({ generate } as never);
    await expect(
      selectAndGenerate(
        { ...request, executionPolicy: "single-submit" } as never,
        {
          leaseContext: { generationId: "g", userId: "u", executionToken: "e" },
        },
      ),
    ).rejects.toBeInstanceOf(ProviderSubmissionUnknownError);
    expect(generate).toHaveBeenCalledOnce();
    expect(mocks.leaseProviderAccount).toHaveBeenCalledOnce();
    expect(mocks.releaseAccountLease).toHaveBeenCalledWith(
      "lease-1",
      "provider_attempt_finished",
    );
  });

  it("returns an already generated image even when health and lease writes fail", async () => {
    mocks.leaseProviderAccount.mockResolvedValue({
      account: { ...saturatedAccount, apiKeyEnc: "key" },
      provider,
      leaseId: "lease-1",
    });
    const generated = { images: [{ url: "https://example.test/image.png" }] };
    const generate = vi.fn().mockResolvedValue(generated);
    vi.mocked(buildAdapter).mockReturnValue({ generate } as never);
    vi.mocked(markProviderHealthy).mockRejectedValueOnce(
      new Error("health write failed"),
    );
    vi.mocked(markAccountHealthy).mockRejectedValueOnce(
      new Error("account write failed"),
    );
    mocks.releaseAccountLease.mockRejectedValueOnce(
      new Error("lease write failed"),
    );

    await expect(
      selectAndGenerate(
        { ...request, executionPolicy: "single-submit" } as never,
        {
          leaseContext: { generationId: "g", userId: "u", executionToken: "e" },
        },
      ),
    ).resolves.toMatchObject({
      result: generated,
      providerAccountId: "account-1",
    });
    expect(generate).toHaveBeenCalledOnce();
  });
});

const fallbackProvider = {
  ...provider,
  id: "ldai-fallback",
  name: "Fallback",
  priority: 0,
  costMultiplier: 2,
  baseUrl: "https://ai.ldai.us/v1",
};
const fallbackAccount = {
  ...saturatedAccount,
  id: "fallback-account",
  providerId: fallbackProvider.id,
  provider: fallbackProvider,
  baseUrl: fallbackProvider.baseUrl,
};
const normalAccount = { ...saturatedAccount, id: "normal-account" };
const automaticRequest = { ...request, providerChannelId: undefined };
const leaseContext = { generationId: "g", userId: "u", executionToken: "e" };
const generated = { images: [{ url: "https://result.test/image.png" }] };

describe("last-resort routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://mocked";
    mocks.db.provider.findMany.mockResolvedValue([]);
    mocks.db.providerAccount.count.mockResolvedValue(0);
    mocks.findEligibleProviderAccounts.mockResolvedValue([
      fallbackAccount,
      normalAccount,
    ]);
    mocks.maxAttemptsForAccounts.mockImplementation((accounts: unknown[]) =>
      Math.min(2, accounts.length),
    );
    mocks.leaseProviderAccount.mockImplementation(async (account) => ({
      account: { ...account, apiKeyEnc: "encrypted" },
      provider: account.provider,
      leaseId: `lease-${account.id}`,
    }));
    vi.mocked(isDowngradable).mockReturnValue(true);
    vi.mocked(buildAdapter).mockReturnValue({
      generate: vi.fn().mockResolvedValue(generated),
    } as never);
    mocks.providerSupportsGif.mockImplementation(
      async (baseUrl) => baseUrl === fallbackProvider.baseUrl,
    );
  });

  it("keeps ordinary success at its ordinary multiplier and never tries fallback", async () => {
    const onProviderSelected = vi.fn();
    const result = await selectAndGenerate(automaticRequest as never, {
      leaseContext,
      onProviderSelected,
    });
    expect(result).toMatchObject({ providerId: provider.id, multiplier: 1 });
    expect(mocks.leaseProviderAccount).toHaveBeenCalledOnce();
    expect(onProviderSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: provider.id,
        costMultiplier: 1,
        baseUrl: normalAccount.baseUrl,
      }),
    );
    expect(mocks.providerSupportsGif).not.toHaveBeenCalled();
  });

  it("tries fallback after the allowed normal budget is exhausted", async () => {
    const second = { ...normalAccount, id: "second" };
    const untried = { ...normalAccount, id: "beyond-budget" };
    mocks.findEligibleProviderAccounts.mockResolvedValue([
      fallbackAccount,
      normalAccount,
      second,
      untried,
    ]);
    const attempts: string[] = [];
    vi.mocked(buildAdapter).mockImplementation(
      ({ id }) =>
        ({
          generate: async () => {
            attempts.push(id);
            if (id !== fallbackAccount.id)
              throw new TypeError("connection reset");
            return generated;
          },
        }) as never,
    );
    const selected: string[] = [];
    const result = await selectAndGenerate(automaticRequest as never, {
      leaseContext,
      onProviderSelected: ({ providerAccountId }) => {
        selected.push(providerAccountId!);
      },
    });
    expect(attempts).toEqual([normalAccount.id, second.id, fallbackAccount.id]);
    expect(selected).toEqual(attempts);
    expect(result).toMatchObject({
      providerId: "ldai-fallback",
      multiplier: 2,
    });
  });

  it("exhausts normal legacy providers before a fallback account", async () => {
    const legacy = { ...provider, id: "legacy-normal" };
    mocks.db.provider.findMany.mockResolvedValue([fallbackProvider, legacy]);
    mocks.db.providerAccount.count.mockImplementation(async ({ where }) =>
      where.providerId === fallbackProvider.id ? 1 : 0,
    );
    const attempts: string[] = [];
    vi.mocked(buildAdapter).mockImplementation(
      ({ id }) =>
        ({
          generate: async () => {
            attempts.push(id);
            if (id !== fallbackAccount.id)
              throw new TypeError("connection reset");
            return generated;
          },
        }) as never,
    );
    await selectAndGenerate(automaticRequest as never, {
      leaseContext,
      onProviderSelected: vi.fn(),
    });
    expect(attempts).toEqual([normalAccount.id, legacy.id, fallbackAccount.id]);
  });

  it("keeps a saturated normal pool in the queue without leasing fallback", async () => {
    mocks.leaseProviderAccount.mockResolvedValue(null);
    await expect(
      selectAndGenerate(automaticRequest as never, {
        leaseContext,
        onProviderSelected: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ProviderCapacityError);
    expect(mocks.leaseProviderAccount).toHaveBeenCalledOnce();
    expect(vi.mocked(buildAdapter)).not.toHaveBeenCalled();
  });

  it("does not use fallback when another normal account is busy after a failure", async () => {
    const busy = { ...normalAccount, id: "busy" };
    mocks.findEligibleProviderAccounts.mockResolvedValue([
      normalAccount,
      busy,
      fallbackAccount,
    ]);
    mocks.leaseProviderAccount.mockImplementation(async (account) =>
      account.id === busy.id
        ? null
        : {
            account: { ...account, apiKeyEnc: "encrypted" },
            provider: account.provider,
            leaseId: account.id,
          },
    );
    vi.mocked(buildAdapter).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new TypeError("network")),
    } as never);
    await expect(
      selectAndGenerate(automaticRequest as never, {
        leaseContext,
        onProviderSelected: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ProviderCapacityError);
    expect(
      mocks.leaseProviderAccount.mock.calls.map(([account]) => account.id),
    ).toEqual([normalAccount.id, busy.id]);
  });

  it("also queues when a busy normal account is beyond the attempt cap", async () => {
    mocks.maxAttemptsForAccounts.mockImplementation((accounts: unknown[]) =>
      Math.min(1, accounts.length),
    );
    mocks.findEligibleProviderAccounts.mockResolvedValue([
      normalAccount,
      { ...normalAccount, id: "busy", inFlight: 1 },
      fallbackAccount,
    ]);
    vi.mocked(buildAdapter).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new TypeError("network")),
    } as never);
    await expect(
      selectAndGenerate(automaticRequest as never, {
        leaseContext,
        onProviderSelected: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ProviderCapacityError);
    expect(mocks.leaseProviderAccount).toHaveBeenCalledOnce();
  });

  it("keeps explicit channel selection restricted", async () => {
    mocks.findEligibleProviderAccounts.mockResolvedValue([normalAccount]);
    mocks.db.provider.findMany.mockResolvedValue([fallbackProvider]);
    vi.mocked(buildAdapter).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new TypeError("network")),
    } as never);
    await expect(
      selectAndGenerate(request as never, {
        leaseContext,
        onProviderSelected: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(mocks.findEligibleProviderAccounts).toHaveBeenCalledWith(
      request.modelId,
      request.providerChannelId,
    );
    expect(mocks.db.provider.findMany).not.toHaveBeenCalled();
    expect(mocks.leaseProviderAccount).toHaveBeenCalledOnce();
  });

  it("never retries an ambiguous single-submit against the paid fallback", async () => {
    vi.mocked(buildAdapter).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new TypeError("connection lost")),
    } as never);
    await expect(
      selectAndGenerate(
        { ...automaticRequest, executionPolicy: "single-submit" } as never,
        { leaseContext, onProviderSelected: vi.fn() },
      ),
    ).rejects.toBeInstanceOf(ProviderSubmissionUnknownError);
    expect(mocks.leaseProviderAccount).toHaveBeenCalledOnce();
  });

  it("does not dispatch or penalize an account when its credit reservation fails", async () => {
    mocks.findEligibleProviderAccounts.mockResolvedValue([fallbackAccount]);
    const insufficient = new Error("insufficient credits");
    await expect(
      selectAndGenerate(
        { ...automaticRequest, executionPolicy: "single-submit" } as never,
        {
          leaseContext,
          onProviderSelected: vi.fn().mockRejectedValue(insufficient),
        },
      ),
    ).rejects.toBe(insufficient);
    expect(
      vi.mocked(buildAdapter).mock.results[0].value.generate,
    ).not.toHaveBeenCalled();
    expect(markAccountErrored).not.toHaveBeenCalled();
    expect(mocks.releaseAccountLease).toHaveBeenCalledWith(
      `lease-${fallbackAccount.id}`,
      "provider_attempt_finished",
    );
  });

  it("refuses paid fallback without the pre-dispatch callback", async () => {
    mocks.findEligibleProviderAccounts.mockResolvedValue([fallbackAccount]);
    await expect(
      selectAndGenerate(automaticRequest as never, { leaseContext }),
    ).rejects.toThrow("pre-dispatch credit reservation");
    expect(
      vi.mocked(buildAdapter).mock.results[0].value.generate,
    ).not.toHaveBeenCalled();
  });

  it("filters GIF accounts by configured capability before trying an upstream", async () => {
    await expect(
      selectAndGenerate({ ...automaticRequest, outputFormat: "gif" } as never, {
        leaseContext,
        onProviderSelected: vi.fn(),
      }),
    ).resolves.toMatchObject({ providerId: fallbackProvider.id });
    expect(mocks.leaseProviderAccount).toHaveBeenCalledOnce();
    expect(mocks.leaseProviderAccount.mock.calls[0][0].id).toBe(
      fallbackAccount.id,
    );
  });

  it("uses a GIF-capable normal account before a GIF-capable fallback", async () => {
    const gifNormal = { ...normalAccount, baseUrl: fallbackProvider.baseUrl };
    mocks.findEligibleProviderAccounts.mockResolvedValue([
      normalAccount,
      fallbackAccount,
      gifNormal,
    ]);
    await expect(
      selectAndGenerate({ ...automaticRequest, outputFormat: "gif" } as never, {
        leaseContext,
        onProviderSelected: vi.fn(),
      }),
    ).resolves.toMatchObject({ providerId: provider.id });
    expect(mocks.leaseProviderAccount).toHaveBeenCalledOnce();
    expect(mocks.leaseProviderAccount.mock.calls[0][0].baseUrl).toBe(
      fallbackProvider.baseUrl,
    );
  });

  it("filters legacy GIF providers and fails before dispatch when none support it", async () => {
    mocks.findEligibleProviderAccounts.mockResolvedValue([]);
    mocks.db.provider.findMany.mockResolvedValue([provider]);
    await expect(
      selectAndGenerate({ ...automaticRequest, outputFormat: "gif" } as never, {
        leaseContext,
        onProviderSelected: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ModelNotAvailableError);
    expect(buildAdapter).not.toHaveBeenCalled();
  });
});
