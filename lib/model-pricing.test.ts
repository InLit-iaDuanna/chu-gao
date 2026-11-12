import { describe, expect, it, vi } from "vitest";

import {
  estimateCostFromSnapshot,
  createPricingSnapshot,
  pricingSnapshotForProvider,
  snapshotProviderMultipliers,
  parsePricingSnapshot,
  type PricingSnapshot,
} from "@/lib/model-pricing";
import { applyApiPricing } from "@/lib/api-pricing";
import { getModel } from "@/lib/models/registry";
import { channelIdFromProvider } from "@/lib/provider-channels";
import type { InternalRequest, ModelDefinition } from "@/lib/models/types";

const snapshot: PricingSnapshot = {
  modelId: "gpt-image-2.5-flare",
  ruleId: "rule-1k",
  perImageCredits: 6,
  perImageCreditsByResolution: {
    "1K": 6,
    "2K": 10,
    "4K": 18,
  },
  estimatedCredits: 6,
  request: {
    size: "auto",
    resolution: "1K",
    aspectRatio: "1:1",
    outputFormat: "png",
    background: "auto",
    usesReference: false,
  },
  createdAt: new Date().toISOString(),
};

describe("pricing snapshot resolution settlement", () => {
  it("charges each auto-sized image using its returned resolution tier", () => {
    expect(estimateCostFromSnapshot(snapshot, 2, 1, ["1K", "4K"])).toBe(24);
  });

  it("keeps legacy snapshots on their fixed per-image price", () => {
    const legacy = { ...snapshot, perImageCreditsByResolution: undefined };

    expect(estimateCostFromSnapshot(legacy, 3)).toBe(18);
  });
});

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
const selection = {
  providerId: "ldai-fallback",
  providerAccountId: "fallback-account",
  baseUrl: "https://ai.ldai.us/v1",
};

function pricedModel(): ModelDefinition {
  return {
    ...getModel(request.modelId)!,
    pricingRules: [
      ["1K", 8],
      ["2K", 10],
      ["4K", 16],
      ["auto", 9],
    ].map(([resolution, credits]) => ({
      id: `rule-${resolution}`,
      modelId: request.modelId,
      resolution: String(resolution),
      credits: Number(credits),
      priority: 0,
    })),
  };
}

describe("provider pricing snapshots", () => {
  it("does not apply fallback pricing to ordinary success", () => {
    const frozen = {
      ...createPricingSnapshot(pricedModel(), request),
      providerMultipliers: { normal: 1, "ldai-fallback": 2 },
    };
    const selected = pricingSnapshotForProvider(
      frozen,
      { ...selection, providerId: "normal" },
      request,
    );
    expect(estimateCostFromSnapshot(selected, 1)).toBe(8);
    expect(selected.selectedProvider?.reservedCredits).toBe(8);
    expect(
      estimateCostFromSnapshot(
        pricingSnapshotForProvider(frozen, selection, request),
        1,
      ),
    ).toBe(16);
  });

  it("uses the selected provider channel's frozen admin rules", () => {
    const model = pricedModel();
    const channel = channelIdFromProvider(
      selection.providerId,
      selection.baseUrl,
    );
    model.pricingRules!.push({
      id: "fallback-override",
      modelId: request.modelId,
      providerChannelId: channel,
      resolution: "1K",
      credits: 11,
      priority: 1,
    });
    const frozen = {
      ...createPricingSnapshot(model, request),
      providerMultipliers: { "ldai-fallback": 2 },
    };
    model.pricingRules!.at(-1)!.credits = 100;
    expect(
      estimateCostFromSnapshot(
        pricingSnapshotForProvider(frozen, selection, request),
        1,
      ),
    ).toBe(22);
    expect(frozen.perImageCredits).toBe(8);
  });

  it("reserves the highest frozen auto tier and settles by the returned tier", () => {
    const auto = { ...request, size: "auto" as const };
    const frozen = {
      ...createPricingSnapshot(pricedModel(), auto),
      providerMultipliers: { "ldai-fallback": 2 },
    };
    const selected = pricingSnapshotForProvider(frozen, selection, auto);
    expect(frozen.estimatedCredits).toBe(9);
    expect(frozen.perImageCreditsByResolution).toEqual({
      "1K": 8,
      "2K": 10,
      "4K": 16,
    });
    expect(selected.selectedProvider?.reservedCredits).toBe(32);
    expect(estimateCostFromSnapshot(selected, 1, 1, ["2K"])).toBe(20);
  });

  it("freezes editable provider multipliers at submission", async () => {
    const providers = [
      { id: "normal", costMultiplier: 1 },
      { id: "ldai-fallback", costMultiplier: 3 },
    ];
    const client = {
      provider: { findMany: vi.fn().mockResolvedValue(providers) },
    };
    const frozen = await snapshotProviderMultipliers(
      createPricingSnapshot(pricedModel(), request),
      request,
      client as never,
    );
    providers[1].costMultiplier = 4;
    expect(
      estimateCostFromSnapshot(
        pricingSnapshotForProvider(frozen, selection, request),
        1,
      ),
    ).toBe(24);
    const later = await snapshotProviderMultipliers(
      createPricingSnapshot(pricedModel(), request),
      request,
      client as never,
    );
    expect(
      estimateCostFromSnapshot(
        pricingSnapshotForProvider(later, selection, request),
        1,
      ),
    ).toBe(32);
    expect(client.provider.findMany.mock.calls[0][0]).toMatchObject({
      where: { isActive: true, protocol: "OPENAI_IMAGES" },
      select: { id: true, costMultiplier: true },
    });
  });

  it.each([undefined, {}])(
    "refuses fallback when no multiplier was frozen (%s)",
    (multipliers) => {
      const frozen = {
        ...createPricingSnapshot(pricedModel(), request),
        providerMultipliers: multipliers,
      };
      expect(() =>
        pricingSnapshotForProvider(frozen, selection, request),
      ).toThrow("not frozen");
    },
  );

  it("accepts both Prisma input JSON and unknown values without accepting invalid snapshots", () => {
    expect(
      parsePricingSnapshot(createPricingSnapshot(pricedModel(), request))
        ?.modelId,
    ).toBe(request.modelId);
    expect(parsePricingSnapshot({ perImageCredits: "8" })).toBeNull();
    expect(parsePricingSnapshot(null)).toBeNull();
  });

  it("applies API multipliers to channel prices before the selected provider factor", () => {
    const model = pricedModel();
    model.pricingRules!.push({
      id: "override",
      modelId: request.modelId,
      providerChannelId: channelIdFromProvider(
        selection.providerId,
        selection.baseUrl,
      ),
      credits: 12,
      priority: 1,
    });
    const frozen = {
      ...createPricingSnapshot(model, request),
      providerMultipliers: { "ldai-fallback": 2 },
    };
    const api = applyApiPricing(frozen, undefined, 1.5, request);
    expect(api.perImageCredits).toBe(12);
    expect(
      estimateCostFromSnapshot(
        pricingSnapshotForProvider(api, selection, request),
        1,
      ),
    ).toBe(36);
    const override = applyApiPricing(frozen, { "1K": 7 }, 1.5, request);
    expect(
      estimateCostFromSnapshot(
        pricingSnapshotForProvider(override, selection, request),
        1,
      ),
    ).toBe(14);
  });

  it("uses API tier overrides as the fallback auto reserve upper bound", () => {
    const auto = { ...request, size: "auto" as const, n: 2 };
    const frozen = {
      ...createPricingSnapshot(pricedModel(), auto),
      providerMultipliers: { "ldai-fallback": 2 },
    };
    const overrides = { "4K": 37 };
    const api = applyApiPricing(frozen, overrides, 1.5, auto);
    overrides["4K"] = 100;
    const selected = pricingSnapshotForProvider(api, selection, auto);
    expect(selected.selectedProvider?.reservedCredits).toBe(148);
    expect(estimateCostFromSnapshot(selected, 2, 1, ["2K", "4K"])).toBe(104);
  });
});
