import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ models: vi.fn(), providers: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { provider: { findMany: mocks.providers } },
}));
vi.mock("@/lib/model-pricing", () => ({ listModelsWithPricing: mocks.models }));

import { GET } from "@/app/api/public/models/route";
import { getModel } from "@/lib/models/registry";

const provider = {
  id: "ldai-fallback",
  protocol: "OPENAI_IMAGES",
  costMultiplier: 2,
  modelsSupported: ["gpt-image-2.5-flare", "gpt-image-2.6-flare"],
  _count: { accounts: 1 },
  accounts: [{ health: "HEALTHY", cooldownUntil: null }],
};
beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgresql://mocked";
  mocks.models.mockResolvedValue(
    ["gpt-image-2.5-flare", "gpt-image-2.6"].map((id) => ({
      ...getModel(id)!,
      pricingRules: [
        { id: "generic", credits: 8 },
        { id: "secret-rule", providerChannelId: "hidden-channel", credits: 10 },
      ],
    })),
  );
  mocks.providers.mockResolvedValue([provider]);
});

describe("public fallback price range", () => {
  it("exposes only a numeric multiplier for supported models and no provider details", async () => {
    const body = await (await GET()).json();
    expect(body.data[0]).toMatchObject({
      available: true,
      fallbackCostMultiplier: 2,
    });
    expect(body.data[0].pricingRules).toEqual([{ id: "generic", credits: 8 }]);
    expect(body.data[1]).not.toHaveProperty("fallbackCostMultiplier");
    const json = JSON.stringify(body);
    for (const secret of [
      "ldai-fallback",
      "hidden-channel",
      "secret-rule",
      "apiKey",
      "baseUrl",
    ])
      expect(json).not.toContain(secret);
    const selection = mocks.providers.mock.calls[0][0].select;
    expect(selection).not.toHaveProperty("apiKeyEnc");
    expect(selection).not.toHaveProperty("name");
  });

  it.each([2, 3.5, 1])(
    "publishes the editable finite factor %s",
    async (factor) => {
      mocks.providers.mockResolvedValue([
        { ...provider, costMultiplier: factor },
      ]);
      expect((await (await GET()).json()).data[0].fallbackCostMultiplier).toBe(
        factor,
      );
    },
  );

  it.each([NaN, Infinity, 0, -1])(
    "sanitizes invalid factors (%s)",
    async (factor) => {
      mocks.providers.mockResolvedValue([
        { ...provider, costMultiplier: factor },
      ]);
      expect((await (await GET()).json()).data[0].fallbackCostMultiplier).toBe(
        2,
      );
    },
  );

  it("does not classify an ordinary marked-up pool as fallback", async () => {
    mocks.providers.mockResolvedValue([
      { ...provider, id: "normal-pool", costMultiplier: 2 },
    ]);
    expect((await (await GET()).json()).data[0]).not.toHaveProperty(
      "fallbackCostMultiplier",
    );
  });
});
