import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  getModel: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: mocks.findUser } },
}));
vi.mock("@/lib/model-pricing", () => ({
  getModelWithPricing: mocks.getModel,
  listModelsWithPricing: mocks.listModels,
}));
vi.mock("@/lib/models/validate", () => ({
  generationRequestSchema: {
    parse: (value: Record<string, unknown>) => ({ ...value }),
  },
  // Each fixture model accepts only its own sizes.
  validateAgainstModelDefinition: (
    input: { size?: string; quality?: string; n: number },
    model: { sizes: string[] },
  ) => {
    const size = input.size ?? model.sizes[0];
    if (!model.sizes.includes(size)) throw new Error("unsupported size");
    return { ...input, size, quality: input.quality ?? "auto" };
  },
}));
vi.mock("@/lib/credits", () => ({
  estimateCost: (model: { price: number }, request: { n: number }) =>
    model.price * request.n,
}));

import { formatCredits, runCheckCreditsTool } from "@/lib/chat-credits-tool";

const models = {
  "gpt-image-2": {
    id: "gpt-image-2",
    displayName: "GPT Image 2",
    price: 6,
    sizes: ["1024x1024", "1536x1024"],
  },
  "flux-pro": {
    id: "flux-pro",
    displayName: "Flux Pro",
    price: 2.5,
    sizes: ["768x768"],
  },
};

describe("check_credits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue({ credits: 20 });
    mocks.getModel.mockImplementation(
      async (id: string) => models[id as keyof typeof models] ?? null,
    );
    mocks.listModels.mockResolvedValue(Object.values(models));
  });

  it("quotes the user's own image settings against the balance", async () => {
    const outcome = await runCheckCreditsTool("{}", {
      userId: "user-a",
      imageModelId: "gpt-image-2",
      imageSize: "1536x1024",
      imageQuality: "high",
      imageN: 2,
    });
    expect(outcome.ok).toBe(true);
    expect(mocks.findUser).toHaveBeenCalledWith({
      where: { id: "user-a" },
      select: { credits: true },
    });
    expect(outcome.output).toContain("当前余额：20 积分");
    expect(outcome.output).toContain(
      "GPT Image 2（gpt-image-2），尺寸 1536x1024，质量 high，2 张 → 预计 12 积分（单张约 6 积分）",
    );
    expect(outcome.output).toContain("余额足够");
    expect(outcome.output).toContain("- Flux Pro（flux-pro）：2.5 积分/张");
    expect(outcome.output).toContain("实际扣费以提交时界面显示为准");
  });

  it("says how much is missing when the balance is short", async () => {
    mocks.findUser.mockResolvedValue({ credits: 4 });
    const outcome = await runCheckCreditsTool("", {
      userId: "user-a",
      imageN: 1,
    });
    expect(outcome.output).toContain("还差约 2 积分");
  });

  it("falls back to the model's defaults when the settings do not fit it", async () => {
    const outcome = await runCheckCreditsTool('{"modelId":"flux-pro"}', {
      userId: "user-a",
      imageModelId: "gpt-image-2",
      imageSize: "1536x1024",
    });
    expect(outcome.output).toContain("Flux Pro（flux-pro），尺寸 768x768");
    expect(outcome.output).toContain("默认设置估算");
  });

  it("reports an unknown model id and quotes the current settings instead", async () => {
    const outcome = await runCheckCreditsTool('{"modelId":"nope"}', {
      userId: "user-a",
    });
    expect(outcome.output).toContain("没有找到 id 为 nope 的图片模型");
    expect(outcome.output).toContain("GPT Image 2（gpt-image-2）");
  });

  it("never throws and never invents numbers on failure", async () => {
    mocks.findUser.mockRejectedValue(new Error("db down"));
    const outcome = await runCheckCreditsTool("{}", { userId: "user-a" });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toContain("不要凭记忆报数字");
    mocks.findUser.mockResolvedValue(null);
    expect(
      (await runCheckCreditsTool("{}", { userId: "user-a" })).ok,
    ).toBe(false);
  });

  it("formats credits without float noise", () => {
    expect(formatCredits(12)).toBe("12");
    expect(formatCredits(2.5)).toBe("2.5");
    expect(formatCredits(0.1 + 0.2)).toBe("0.3");
    expect(formatCredits(Number.NaN)).toBe("0");
  });
});
