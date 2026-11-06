import { describe, expect, it } from "vitest";

import {
  estimateCostFromSnapshot,
  type PricingSnapshot,
} from "@/lib/model-pricing";

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
    expect(
      estimateCostFromSnapshot(snapshot, 2, 1, ["1K", "4K"]),
    ).toBe(24);
  });

  it("keeps legacy snapshots on their fixed per-image price", () => {
    const legacy = { ...snapshot, perImageCreditsByResolution: undefined };

    expect(estimateCostFromSnapshot(legacy, 3)).toBe(18);
  });
});
