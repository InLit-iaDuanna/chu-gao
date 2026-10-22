import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { estimateCostFromSnapshot, type PricingSnapshot } from "@/lib/model-pricing";

import { applyApiPricing } from "./api-pricing";

const webSnapshot: PricingSnapshot = {
  modelId: "gpt-image-2",
  ruleId: "rule-1k",
  perImageCredits: 8,
  perImageCreditsByResolution: { "1K": 8, "2K": 9, "4K": 16 },
  estimatedCredits: 16,
  request: {
    size: "1024x1024",
    resolution: "1K",
    aspectRatio: "1:1",
    outputFormat: "png",
    background: "auto",
    usesReference: false,
  },
  createdAt: "2026-10-23T00:00:00.000Z",
};

describe("applyApiPricing", () => {
  it("uses explicit API prices and charges them at settlement", () => {
    const snapshot = applyApiPricing(webSnapshot, { "1K": 5, "4K": 12 }, 1, {
      resolution: "1K",
      n: 2,
    });

    expect(snapshot.channel).toBe("api");
    expect(snapshot.perImageCredits).toBe(5);
    expect(snapshot.estimatedCredits).toBe(10);
    // Settlement recomputes from the snapshot with multiplier 1.
    expect(estimateCostFromSnapshot(snapshot, 2)).toBe(10);
    expect(estimateCostFromSnapshot(snapshot, 1, 1, ["4K"])).toBe(12);
  });

  it("falls back to web price × multiplier for tiers without an API price", () => {
    const snapshot = applyApiPricing(webSnapshot, { "1K": 5 }, 1.5, {
      resolution: "2K",
      n: 1,
    });

    expect(snapshot.perImageCredits).toBe(12);
    expect(snapshot.perImageCreditsByResolution).toEqual({ "1K": 5, "2K": 13.5, "4K": 24 });
    expect(snapshot.estimatedCredits).toBe(12);
    // The multiplier survives settlement instead of being refunded.
    expect(estimateCostFromSnapshot(snapshot, 1, 1, ["2K"])).toBe(14);
  });

  it("keeps web prices unchanged at multiplier 1 with no overrides", () => {
    const snapshot = applyApiPricing(webSnapshot, undefined, 1, {
      resolution: "1K",
      n: 2,
    });

    expect(snapshot.perImageCredits).toBe(8);
    expect(snapshot.estimatedCredits).toBe(16);
    expect(snapshot.perImageCreditsByResolution).toEqual(webSnapshot.perImageCreditsByResolution);
  });
});
