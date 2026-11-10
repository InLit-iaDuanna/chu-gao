import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    provider: { findMany: vi.fn() },
    providerAccount: { count: vi.fn() },
  },
  findEligibleProviderAccounts: vi.fn(),
  leaseProviderAccount: vi.fn(),
  maxAttemptsForAccounts: vi.fn(() => 1),
  releaseAccountLease: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn((value) => value) }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/models/registry", () => ({
  getModel: vi.fn(() => ({ protocol: "OPENAI_IMAGES" })),
}));
vi.mock("@/lib/provider-channels", () => ({
  displayNameForProviderChannel: vi.fn(() => "Test channel"),
  getImage2ProviderChannel: vi.fn(() => ({ displayName: "Test channel" })),
}));
vi.mock("@/lib/providers/account-pool", () => ({
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
vi.mock("@/lib/providers/channel-circuit-breaker", () => ({
  isChannelCircuitOpen: vi.fn(async () => false),
  resetChannelCircuit: vi.fn(async () => undefined),
  tripChannelCircuit: vi.fn(async () => undefined),
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
  assertProviderAvailable,
  selectAndGenerate,
} from "@/lib/providers";
import { buildAdapter } from "@/lib/providers/factory";
import { isDowngradable } from "@/lib/providers/failure-policy";
import { ProviderSubmissionUnknownError } from "@/lib/providers/single-submit";
import {
  markAccountHealthy,
  markProviderHealthy,
} from "@/lib/providers/health";

const provider = {
  id: "provider-1",
  name: "Provider",
  protocol: "OPENAI_IMAGES",
  priority: 100,
};
const saturatedAccount = {
  id: "account-1",
  providerId: provider.id,
  baseUrl: "https://example.com/v1",
  provider,
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
