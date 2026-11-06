import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  rateLimit: vi.fn(),
  getTrustTier: vi.fn(),
  postFindUnique: vi.fn(),
  generatedFindFirst: vi.fn(),
  transaction: vi.fn(),
  mediaCreate: vi.fn(),
  mediaUpdateMany: vi.fn(),
  mediaDeleteMany: vi.fn(),
  postUpdate: vi.fn(),
  parentFindUnique: vi.fn(),
  copySnapshot: vi.fn(),
  removeSnapshots: vi.fn(),
}));

vi.mock("@/lib/api-rate-limit", () => ({
  userActionRateLimitResponse: mocks.rateLimit,
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: {
    designPost: { findUnique: mocks.postFindUnique },
    generatedImage: { findFirst: mocks.generatedFindFirst },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/inspiration", () => ({
  getTrustTier: mocks.getTrustTier,
  publicRecipeSnapshot: () => null,
  rankScoreForCounts: () => 13,
}));

vi.mock("@/lib/models/registry", () => ({ getModel: () => null }));

vi.mock("@/lib/storage", () => ({
  copyStorageToDesignPostSnapshot: mocks.copySnapshot,
  removeDesignPostSnapshots: mocks.removeSnapshots,
}));

import { POST } from "@/app/api/inspiration/posts/[id]/media/route";

const generatedImageId = "cmseizlrb00073y9wtsvj0uaf";
const secondGeneratedImageId = "cmsejhya4000n3y9wkswylgbd";

const user = {
  id: "user-1",
  email: "designer@example.com",
  role: "USER" as const,
  status: "ACTIVE" as const,
  sessionVersion: 1,
};

function post(
  overrides: Partial<{
    status: "DRAFT" | "PENDING" | "PUBLISHED" | "HIDDEN";
    shape: "WORK" | "REFERENCE";
    derivedFromPostId: string | null;
    media: Array<{
      id: string;
      sourceGeneratedImageId: string | null;
      isCover: boolean;
      order: number;
    }>;
  }> = {},
) {
  return {
    id: "post-1",
    authorId: user.id,
    shape: overrides.shape ?? "WORK",
    status: overrides.status ?? "DRAFT",
    deletedAt: null,
    derivedFromPostId: overrides.derivedFromPostId ?? null,
    media: overrides.media ?? [],
  };
}

function mediaRequest(media: Array<Record<string, unknown>>) {
  return POST(
    new Request("https://chugao.test/api/inspiration/posts/post-1/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ media }),
    }),
    { params: Promise.resolve({ id: "post-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue({ status: "authenticated", user });
  mocks.rateLimit.mockResolvedValue(null);
  mocks.getTrustTier.mockResolvedValue("TRUSTED");
  mocks.parentFindUnique.mockResolvedValue(null);
  mocks.copySnapshot.mockResolvedValue({
    storageKey: "design-posts/post-1/2.png",
    thumbnailKey: "design-posts/post-1/2-thumb.webp",
    width: 100,
    height: 100,
    mimeType: "image/png",
    sizeBytes: 1_024,
  });
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      designPostMedia: {
        create: mocks.mediaCreate,
        updateMany: mocks.mediaUpdateMany,
        deleteMany: mocks.mediaDeleteMany,
      },
      designPost: {
        update: mocks.postUpdate,
        findUnique: mocks.parentFindUnique,
      },
    }),
  );
});

describe("inspiration post media append route", () => {
  it("does not add images to a REFERENCE post", async () => {
    mocks.postFindUnique.mockResolvedValue(post({ shape: "REFERENCE" }));

    const response = await mediaRequest([
      {
        sourceKey: "uploads/user-1/reference.png",
        mimeType: "image/png",
      },
    ]);

    expect(response.status).toBe(409);
    expect(mocks.copySnapshot).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not copy or submit a generated image already attached to the post", async () => {
    mocks.postFindUnique.mockResolvedValue(
      post({
        media: [
          {
            id: "media-1",
            sourceGeneratedImageId: generatedImageId,
            isCover: true,
            order: 0,
          },
        ],
      }),
    );

    const response = await mediaRequest([
      { sourceGeneratedImageId: generatedImageId },
    ]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { added: 0, total: 1 },
    });
    expect(mocks.generatedFindFirst).not.toHaveBeenCalled();
    expect(mocks.copySnapshot).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("deduplicates repeated new media and leaves existing rows untouched", async () => {
    mocks.postFindUnique.mockResolvedValue(
      post({
        media: [
          {
            id: "media-1",
            sourceGeneratedImageId: generatedImageId,
            isCover: true,
            order: 0,
          },
        ],
      }),
    );
    mocks.generatedFindFirst.mockResolvedValue({
      id: secondGeneratedImageId,
      storageKey: "generated/second.png",
      mimeType: "image/png",
      generation: {
        prompt: "prompt",
        negativePrompt: null,
        aspectRatio: "1:1",
        resolution: "1024x1024",
        seed: null,
        modelId: "model-1",
      },
    });

    const response = await mediaRequest([
      { sourceGeneratedImageId: secondGeneratedImageId },
      { sourceGeneratedImageId: secondGeneratedImageId },
    ]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { added: 1, total: 2 },
    });
    expect(mocks.copySnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.mediaCreate).toHaveBeenCalledTimes(1);
    expect(mocks.mediaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        postId: "post-1",
        order: 1,
        isCover: false,
        sourceGeneratedImageId: secondGeneratedImageId,
      }),
    });
    expect(mocks.mediaDeleteMany).not.toHaveBeenCalled();
    expect(mocks.mediaUpdateMany).not.toHaveBeenCalled();
  });

  it("replaces the cover flag without deleting an existing image", async () => {
    mocks.postFindUnique.mockResolvedValue(
      post({
        media: [
          {
            id: "media-1",
            sourceGeneratedImageId: generatedImageId,
            isCover: true,
            order: 0,
          },
        ],
      }),
    );

    const response = await mediaRequest([
      {
        sourceKey: "uploads/user-1/new-cover.png",
        mimeType: "image/png",
        isCover: true,
      },
    ]);

    expect(response.status).toBe(200);
    expect(mocks.mediaUpdateMany).toHaveBeenCalledWith({
      where: { postId: "post-1", deletedAt: null, isCover: true },
      data: { isCover: false },
    });
    expect(mocks.mediaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isCover: true, order: 1 }),
    });
    expect(mocks.mediaDeleteMany).not.toHaveBeenCalled();
  });

  it("moves a RESTRICTED author's published post back to PENDING when media is added", async () => {
    mocks.postFindUnique.mockResolvedValue(
      post({ status: "PUBLISHED", derivedFromPostId: "parent-1" }),
    );
    mocks.getTrustTier.mockResolvedValue("RESTRICTED");
    mocks.parentFindUnique.mockResolvedValue({
      id: "parent-1",
      derivedCount: 3,
      likeCount: 1,
      bookmarkCount: 2,
      commentCount: 4,
      publishedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const response = await mediaRequest([
      {
        sourceKey: "uploads/user-1/revision.png",
        mimeType: "image/png",
      },
    ]);

    expect(response.status).toBe(200);
    expect(mocks.postUpdate).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: {
        hasMedia: true,
        status: "PENDING",
        trustTier: "RESTRICTED",
        rankScore: 0,
      },
    });
    expect(mocks.postUpdate).toHaveBeenCalledWith({
      where: { id: "parent-1" },
      data: { derivedCount: 2, rankScore: 13 },
    });
  });
});
