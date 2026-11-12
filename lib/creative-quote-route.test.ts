import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  model: vi.fn(),
  image: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ checkSession: mocks.session }));
vi.mock("@/lib/model-pricing", () => ({ getModelWithPricing: mocks.model }));
vi.mock("@/lib/db", () => ({
  db: { generatedImage: { findFirst: mocks.image } },
}));
vi.mock("@/lib/api-rate-limit", () => ({
  userActionRateLimitResponse: async () => null,
}));
vi.mock("@/lib/storage", async (original) => ({
  ...(await original<typeof import("@/lib/storage")>()),
  statPrivateStorageKey: mocks.stat,
}));
import { POST } from "@/app/api/creative/quote/route";
import { EMPTY_CREATIVE_BRIEF } from "./creative-brief";
import { getModel } from "./models/registry";
const run = (baseReference: unknown = null) =>
  POST(
    new Request("https://example.test/api/creative/quote", {
      method: "POST",
      body: JSON.stringify({
        modelId: "gpt-image-2",
        size: "1024x1024",
        brief: { ...EMPTY_CREATIVE_BRIEF, goal: "改造栏杆" },
        baseReference,
      }),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    user: { id: "owner" },
  });
  mocks.model.mockResolvedValue({
    ...getModel("gpt-image-2"),
    pricingRules: [
      {
        id: "reference",
        modelId: "gpt-image-2",
        usesReference: true,
        credits: 12,
        priority: 0,
      },
    ],
  });
  mocks.image.mockResolvedValue({
    storageKey: "generated/a.png",
    mimeType: "image/png",
  });
});
describe("creative quote without generation", () => {
  it("quotes the selected source as a reference image and checks ownership", async () => {
    const response = await run({ kind: "source", key: "image-1" });
    expect(response.status).toBe(200);
    expect((await response.json()).data.estimatedCredits).toBe(12);
    expect(mocks.image).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "image-1",
          generation: { userId: "owner", deletedAt: null },
        },
      }),
    );
    expect(mocks.stat).toHaveBeenCalledWith("generated/a.png");
  });
  it("rejects foreign uploads without opening a file", async () => {
    expect(
      (await run({ kind: "upload", key: "uploads/foreign/a.png" })).status,
    ).toBe(404);
    expect(mocks.stat).not.toHaveBeenCalled();
  });
  it("rejects deleted or missing source images", async () => {
    mocks.image.mockResolvedValue(null);
    expect((await run({ kind: "source", key: "gone" })).status).toBe(404);
  });
  it("fails closed when the file has expired", async () => {
    mocks.stat.mockRejectedValue(new Error("ENOENT"));
    expect((await run({ kind: "source", key: "gone" })).status).toBe(400);
  });
});
