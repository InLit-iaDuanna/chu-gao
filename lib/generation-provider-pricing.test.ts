import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    generation: { findUnique: mocks.snapshot },
  },
}));
vi.mock("@/lib/models/runtime-config", () => ({
  getConfiguredModel: async () => null,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn() } }));

import {
  createPricingSnapshot,
  type PricingSnapshot,
} from "@/lib/model-pricing";
import { getModel } from "@/lib/models/registry";
import type { InternalRequest } from "@/lib/models/types";
import {
  ProviderCreditsError,
  reserveGenerationProviderCredits,
  settleGenerationFailure,
  settleGenerationSuccess,
} from "@/workers/generation-worker-settlement";
import {
  generationFailureCode,
  usageFailureCategory,
  userFacingGenerationError,
} from "@/workers/generation-worker-errors";

const request: InternalRequest = {
  modelId: "gpt-image-2.5-flare",
  protocol: "openai-images",
  prompt: "test",
  size: "1024x1024",
  quality: "high",
  responseFormat: "b64_json",
  resolution: "1K",
  aspectRatio: "1:1",
  n: 1,
  outputFormat: "png",
  background: "auto",
};
const execution = { generationId: "g", userId: "u", executionToken: "e" };
const fallback = {
  providerId: "ldai-fallback",
  providerAccountId: "fallback-1",
  baseUrl: "https://ai.ldai.us/v1",
};
const normal = {
  ...fallback,
  providerId: "normal",
  providerAccountId: "normal-1",
};
const image = {
  storageKey: "generated/image.png",
  width: 1024,
  height: 1024,
  sizeBytes: 100,
  mimeType: "image/png",
};

interface State {
  balance: number;
  status: string;
  executionToken: string;
  pricingSnapshot: PricingSnapshot | null;
  costCredits: number;
  ledger: { action: string; creditsDelta: number; metadata?: unknown }[];
}
let state: State;
let tx: ReturnType<typeof makeTransaction>;

function frozenPricing(req = request): PricingSnapshot {
  const model = {
    ...getModel(req.modelId)!,
    pricingRules: [
      ["1K", 8],
      ["2K", 10],
      ["4K", 16],
      ["auto", 9],
    ].map(([resolution, credits]) => ({
      id: String(resolution),
      modelId: req.modelId,
      resolution: String(resolution),
      credits: Number(credits),
      priority: 0,
    })),
  };
  return {
    ...createPricingSnapshot(model, req),
    providerMultipliers: { normal: 1, "ldai-fallback": 2 },
  };
}

function makeTransaction() {
  return {
    generation: {
      updateMany: vi.fn(async ({ where, data }) => {
        if (
          where.status !== state.status ||
          where.executionToken !== state.executionToken
        )
          return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({
        pricingSnapshot: structuredClone(state.pricingSnapshot),
      })),
      update: vi.fn(async ({ data }) => {
        Object.assign(state, data);
      }),
    },
    user: {
      updateMany: vi.fn(async ({ where, data }) => {
        if (state.balance < where.credits.gte) return { count: 0 };
        state.balance -= data.credits.decrement;
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }) => {
        state.balance += data.credits.increment;
      }),
    },
    usageLog: {
      aggregate: vi.fn(async ({ where }) => ({
        _sum: {
          creditsDelta: state.ledger
            .filter((row) =>
              typeof where.action === "string"
                ? row.action === where.action
                : where.action.in.includes(row.action),
            )
            .reduce((sum, row) => sum + row.creditsDelta, 0),
        },
      })),
      create: vi.fn(async ({ data }) => {
        state.ledger.push(data);
      }),
    },
    generatedImage: { createMany: vi.fn() },
  };
}

const reserve = (selection = fallback, req = request) =>
  reserveGenerationProviderCredits({ ...execution, request: req, selection });
const succeed = (req = request, images = [image], provider = fallback) =>
  settleGenerationSuccess({
    ...execution,
    request: req,
    estimatedCredits: req.size === "auto" ? 9 : 8,
    providerId: provider.providerId,
    providerAccountId: provider.providerAccountId,
    savedImages: images,
  });
const fail = () =>
  settleGenerationFailure({
    ...execution,
    modelId: request.modelId,
    estimatedCredits: 8,
    failureCode: "PROVIDER_ERROR",
    failureMessage: "failed",
    failureCategory: "provider",
  });
const netCharge = () =>
  Math.max(0, -state.ledger.reduce((sum, row) => sum + row.creditsDelta, 0));

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    balance: 50,
    status: "RUNNING",
    executionToken: "e",
    pricingSnapshot: frozenPricing(),
    costCredits: 8,
    ledger: [{ action: "generate", creditsDelta: -8 }],
  };
  tx = makeTransaction();
  mocks.snapshot.mockImplementation(async () => ({
    pricingSnapshot: structuredClone(state.pricingSnapshot),
  }));
  // Model row-lock serialization and rollback, including two callbacks for the
  // same execution. No database or provider is contacted by these tests.
  let pending: Promise<unknown> = Promise.resolve();
  mocks.transaction.mockImplementation((callback) => {
    const result = pending.then(async () => {
      const before = structuredClone(state);
      try {
        return await callback(tx);
      } catch (error) {
        state = before;
        throw error;
      }
    });
    pending = result.catch(() => undefined);
    return result;
  });
});

describe("pre-dispatch provider credit reservation", () => {
  it("keeps ordinary success at the existing price without reserving fallback credits", async () => {
    await reserve(normal);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(await succeed(request, [image], normal)).toBe(true);
    expect(state.costCredits).toBe(8);
    expect(netCharge()).toBe(8);
    expect(state.balance).toBe(50);
  });

  it("reserves and charges exactly twice for fallback, including concurrent duplicate callbacks", async () => {
    await Promise.all([reserve(), reserve()]);
    await reserve({ ...fallback, providerAccountId: "fallback-retry" });
    expect(tx.user.updateMany).toHaveBeenCalledOnce();
    expect(state.balance).toBe(42);
    expect(netCharge()).toBe(16);
    expect(await succeed()).toBe(true);
    expect(await succeed()).toBe(false);
    expect(state.costCredits).toBe(16);
    expect(netCharge()).toBe(16);
    expect(tx.generatedImage.createMany).toHaveBeenCalledOnce();
    expect(tx.generation.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.usageLog.aggregate.mock.invocationCallOrder[0],
    );
  });

  it("refuses insufficient balance atomically, leaving only the original debit to refund", async () => {
    state.balance = 7;
    await expect(reserve()).rejects.toBeInstanceOf(ProviderCreditsError);
    expect(state.pricingSnapshot?.selectedProvider).toBeUndefined();
    expect(state.ledger).toHaveLength(1);
    expect(state.balance).toBe(7);
    expect(await fail()).toBe(true);
    expect(await fail()).toBe(false);
    expect(state.balance).toBe(15);
    expect(netCharge()).toBe(0);
  });

  it("refunds all fallback reserves once when generation fails", async () => {
    await reserve();
    expect(await fail()).toBe(true);
    expect(await fail()).toBe(false);
    expect(state.balance).toBe(58);
    expect(netCharge()).toBe(0);
    expect(state.ledger.filter((row) => row.action === "refund")).toHaveLength(
      1,
    );
  });

  it("keeps a reserve through a queue retry and refunds the excess if a normal provider later succeeds", async () => {
    await reserve();
    await reserve(normal);
    expect(await succeed(request, [image], normal)).toBe(true);
    expect(state.costCredits).toBe(8);
    expect(netCharge()).toBe(8);
    expect(state.balance).toBe(50);
  });

  it("accounts for earlier refunds when computing the remaining reservation", async () => {
    state.balance = 53;
    state.ledger.push({ action: "refund", creditsDelta: 3 });
    await reserve();
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u", credits: { gte: 11 } },
      data: { credits: { decrement: 11 } },
    });
    await fail();
    expect(netCharge()).toBe(0);
    expect(state.balance).toBe(58);
  });

  it("does not charge or dispatch a superseded execution", async () => {
    state.executionToken = "other";
    await expect(reserve()).rejects.toThrow("superseded");
    expect(tx.usageLog.aggregate).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("refuses paid fallback for legacy jobs without a frozen multiplier", async () => {
    delete state.pricingSnapshot!.providerMultipliers;
    await expect(reserve()).rejects.toThrow("not frozen");
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("shows a billing error without disclosing the provider", () => {
    const error = new ProviderCreditsError();
    expect(generationFailureCode(error)).toBe("INSUFFICIENT_CREDITS");
    expect(usageFailureCategory(error)).toBe("billing");
    expect(userFacingGenerationError(error)).toBe(
      "积分不足，无法使用备用价格；本次未生成，已退还预扣积分",
    );
  });
});

describe("fallback auto-size settlement", () => {
  const auto = { ...request, size: "auto" as const };
  beforeEach(() => {
    state.pricingSnapshot = frozenPricing(auto);
    state.costCredits = 9;
    state.balance = 100;
    state.ledger = [{ action: "generate", creditsDelta: -9 }];
  });

  it("reserves the 4K upper bound before dispatch and refunds down to the returned 2K price", async () => {
    await reserve(fallback, auto);
    expect(state.balance).toBe(77);
    expect(state.pricingSnapshot!.selectedProvider?.reservedCredits).toBe(32);
    expect(netCharge()).toBe(32);
    await succeed(auto, [{ ...image, width: 2048, height: 2048 }]);
    expect(state.costCredits).toBe(20);
    expect(netCharge()).toBe(20);
    expect(state.balance).toBe(89);
  });

  it("rejects a balance that covers the auto quote but not the fallback upper bound", async () => {
    state.balance = 10;
    await expect(reserve(fallback, auto)).rejects.toBeInstanceOf(
      ProviderCreditsError,
    );
    expect(netCharge()).toBe(9);
    expect(state.balance).toBe(10);
  });

  it("settles a confirmed single submission against the reserved fallback price", async () => {
    const single = { ...auto, executionPolicy: "single-submit" as const };
    await reserve(fallback, single);
    await succeed(single, [{ ...image, width: 2048, height: 2048 }]);
    expect(state.costCredits).toBe(20);
    expect(netCharge()).toBe(20);
  });

  it("refunds a partial batch from its full reserved upper bound", async () => {
    const batch = { ...auto, n: 2 };
    state.pricingSnapshot = frozenPricing(batch);
    state.costCredits = 18;
    state.ledger = [{ action: "generate", creditsDelta: -18 }];
    await reserve(fallback, batch);
    expect(netCharge()).toBe(64);
    await succeed(batch, [image]);
    expect(state.costCredits).toBe(16);
    expect(netCharge()).toBe(16);
  });
});
