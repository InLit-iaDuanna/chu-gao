import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  generation: vi.fn(),
  images: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ checkSession: mocks.session }));
vi.mock("@/lib/db", () => ({
  db: {
    generation: { findFirst: mocks.generation },
    generatedImage: { findMany: mocks.images },
    usageLog: { groupBy: async () => [] },
  },
}));
vi.mock("@/lib/generations", () => ({
  serializeGeneration: (row: { id: string }) => ({ id: row.id }),
}));
vi.mock("@/lib/provider-channel-config", () => ({
  getProviderChannelDisplayNameMap: async () => ({}),
}));
vi.mock("@/lib/service-errors", () => ({
  isDatabaseUnavailableError: () => false,
}));
vi.mock("@/lib/storage", () => ({
  statPrivateStorageKey: mocks.stat,
  privateImageUrl: (generation: string, image: string) =>
    `/api/generations/${generation}/images/${image}`,
}));

import { GET } from "@/app/api/generations/[id]/route";
const run = () =>
  GET(new Request("https://example.test/api/generations/g1?retry=1"), {
    params: Promise.resolve({ id: "g1" }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "test");
  mocks.session.mockResolvedValue({
    status: "authenticated",
    user: { id: "owner" },
  });
  mocks.generation.mockResolvedValue({
    id: "g1",
    referenceImageKeys: ["uploads/owner/a.png", "generated/old/b.png"],
  });
  mocks.images.mockResolvedValue([
    { id: "image1", generationId: "old", storageKey: "generated/old/b.png" },
  ]);
  mocks.stat.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("generation retry references", () => {
  it("preserves mixed upload/source references and scopes both queries to the owner", async () => {
    const response = await run();
    expect(response.status).toBe(200);
    expect((await response.json()).data.retryReferences).toEqual([
      {
        kind: "upload",
        key: "uploads/owner/a.png",
        previewUrl: "/api/upload?key=uploads%2Fowner%2Fa.png",
      },
      {
        kind: "source",
        key: "image1",
        previewUrl: "/api/generations/old/images/image1",
      },
    ]);
    expect(mocks.generation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1", userId: "owner", deletedAt: null },
      }),
    );
    expect(mocks.images).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          generation: { userId: "owner", deletedAt: null },
        }),
      }),
    );
  });
  it("rejects missing reference files", async () => {
    mocks.stat.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    expect((await run()).status).toBe(404);
  });
  it("rejects foreign uploads before opening the file", async () => {
    mocks.generation.mockResolvedValue({
      id: "g1",
      referenceImageKeys: ["uploads/other/a.png"],
    });
    expect((await run()).status).toBe(404);
    expect(mocks.stat).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated access", async () => {
    mocks.session.mockResolvedValue({ status: "unauthenticated" });
    expect((await run()).status).toBe(401);
    expect(mocks.generation).not.toHaveBeenCalled();
  });
});
