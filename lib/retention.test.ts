import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generationUpdateMany: vi.fn(),
  generationFindMany: vi.fn(),
  conversationUpdateMany: vi.fn(),
  conversationFindMany: vi.fn(),
  conversationMessageDeleteMany: vi.fn(),
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
    conversation: {
      updateMany: mocks.conversationUpdateMany,
      findMany: mocks.conversationFindMany,
    },
    conversationMessage: { deleteMany: mocks.conversationMessageDeleteMany },
    designPost: { findMany: mocks.postFindMany },
    designPostMedia: { updateMany: mocks.mediaUpdateMany },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  },
}));

vi.mock("@/lib/storage", () => ({
  removeDesignPostSnapshots: mocks.removeSnapshots,
  removeExpiredUploadedReferences: mocks.removeExpiredUploads,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.loggerInfo },
}));

import {
  cleanupExpiredData,
  LOCAL_CONVERSATION_RETENTION_DAYS,
} from "@/lib/retention";

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgresql://test.invalid/retention";
  mocks.generationUpdateMany.mockResolvedValue({ count: 2 });
  mocks.generationFindMany.mockResolvedValue([
    { referenceImageKeys: ["uploads/user-1/keep.png"] },
  ]);
  mocks.conversationUpdateMany.mockResolvedValue({ count: 3 });
  mocks.conversationFindMany.mockResolvedValue([]);
  mocks.conversationMessageDeleteMany.mockResolvedValue({ count: 0 });
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
      localConversationsPurged: 0,
      designPostMediaPurged: 1,
      uploadedReferencesPurged: 4,
    });
  });

  it("archives idle device-local conversations and clears their server messages", async () => {
    const now = new Date("2026-08-04T08:00:00.000Z");
    const localCutoff = new Date(
      now.getTime() - LOCAL_CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    expect(LOCAL_CONVERSATION_RETENTION_DAYS).toBe(7);
    mocks.conversationFindMany.mockResolvedValue([
      { id: "conv-local-1" },
      { id: "conv-local-2" },
    ]);
    mocks.conversationMessageDeleteMany.mockResolvedValue({ count: 5 });

    const result = await cleanupExpiredData(now);

    expect(mocks.conversationFindMany).toHaveBeenCalledWith({
      where: {
        storage: "LOCAL",
        archivedAt: null,
        lastMessageAt: { lt: localCutoff },
      },
      select: { id: true },
      orderBy: { lastMessageAt: "asc" },
      take: 500,
    });
    expect(mocks.conversationUpdateMany).toHaveBeenCalledWith({
      where: { id: "conv-local-1", archivedAt: null },
      data: { archivedAt: now },
    });
    expect(mocks.conversationMessageDeleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-local-1" },
    });
    expect(mocks.conversationMessageDeleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-local-2" },
    });
    // The 30-day sweep still runs for cloud conversations.
    expect(mocks.conversationUpdateMany).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        lastMessageAt: {
          lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      data: { archivedAt: now },
    });
    expect(result.localConversationsPurged).toBe(10);
  });
});
