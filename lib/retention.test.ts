import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generationUpdateMany: vi.fn(),
  generationFindMany: vi.fn(),
  conversationUpdateMany: vi.fn(),
  postFindMany: vi.fn(),
  mediaUpdateMany: vi.fn(),
  removeSnapshots: vi.fn(),
  removeExpiredUploads: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generation: {
      updateMany: mocks.generationUpdateMany,
      findMany: mocks.generationFindMany,
    },
    conversation: { updateMany: mocks.conversationUpdateMany },
    designPost: { findMany: mocks.postFindMany },
    designPostMedia: { updateMany: mocks.mediaUpdateMany },
  },
}));

vi.mock("@/lib/storage", () => ({
  removeDesignPostSnapshots: mocks.removeSnapshots,
  removeExpiredUploadedReferences: mocks.removeExpiredUploads,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.loggerInfo },
}));

import { cleanupExpiredData } from "@/lib/retention";

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgresql://test.invalid/retention";
  mocks.generationUpdateMany.mockResolvedValue({ count: 2 });
  mocks.generationFindMany.mockResolvedValue([
    { referenceImageKeys: ["uploads/user-1/keep.png"] },
  ]);
  mocks.conversationUpdateMany.mockResolvedValue({ count: 3 });
  mocks.postFindMany.mockResolvedValue([
    {
      id: "post-1",
      media: [
        {
          storageKey: "design-posts/post-1/1.png",
          thumbnailKey: "design-posts/post-1/1-thumb.webp",
        },
      ],
    },
  ]);
  mocks.mediaUpdateMany.mockResolvedValue({ count: 1 });
  mocks.removeExpiredUploads.mockResolvedValue(4);
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("retention cleanup", () => {
  it("selects only deleted posts that still have unpurged media", async () => {
    const now = new Date("2026-08-04T08:00:00.000Z");
    const cutoff = new Date("2026-07-05T08:00:00.000Z");

    const result = await cleanupExpiredData(now);

    expect(mocks.postFindMany).toHaveBeenCalledWith({
      where: {
        deletedAt: { not: null, lt: cutoff },
        media: { some: { deletedAt: null } },
      },
      include: {
        media: {
          where: { deletedAt: null },
          select: { storageKey: true, thumbnailKey: true },
        },
      },
      orderBy: { deletedAt: "asc" },
      take: 500,
    });
    expect(mocks.removeSnapshots).toHaveBeenCalledWith([
      {
        storageKey: "design-posts/post-1/1.png",
        thumbnailKey: "design-posts/post-1/1-thumb.webp",
      },
    ]);
    expect(mocks.mediaUpdateMany).toHaveBeenCalledWith({
      where: { postId: "post-1", deletedAt: null },
      data: { deletedAt: now },
    });
    expect(mocks.removeExpiredUploads).toHaveBeenCalledWith({
      cutoff,
      protectedKeys: ["uploads/user-1/keep.png"],
    });
    expect(result).toEqual({
      cutoff: cutoff.toISOString(),
      generationsSoftDeleted: 2,
      conversationsArchived: 3,
      designPostMediaPurged: 1,
      uploadedReferencesPurged: 4,
    });
  });
});
