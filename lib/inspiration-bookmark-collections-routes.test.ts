import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  transaction: vi.fn(),
  collectionFindFirst: vi.fn(),
  postFindFirst: vi.fn(),
  bookmarkFindUnique: vi.fn(),
  bookmarkCreate: vi.fn(),
  likeCount: vi.fn(),
  bookmarkCount: vi.fn(),
  postUpdate: vi.fn(),
  itemUpsert: vi.fn(),
  itemDeleteMany: vi.fn(),
  getTrustTier: vi.fn(),
  rankScoreForCounts: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    bookmarkCollectionItem: {
      deleteMany: mocks.itemDeleteMany,
    },
  },
}));

vi.mock("@/lib/inspiration", () => ({
  getTrustTier: mocks.getTrustTier,
  rankScoreForCounts: mocks.rankScoreForCounts,
}));

import {
  DELETE as removeCollectionItem,
  POST as addCollectionItem,
} from "@/app/api/inspiration/bookmark-collections/[id]/items/route";

const session = {
  status: "authenticated" as const,
  user: {
    id: "user-1",
    email: "designer@example.com",
    role: "USER" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  },
};

function itemRequest(method: "POST" | "DELETE", postId = "post-1") {
  return new Request(
    "https://chugao.test/api/inspiration/bookmark-collections/collection-1/items",
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue(session);
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      bookmarkCollection: { findFirst: mocks.collectionFindFirst },
      designPost: {
        findFirst: mocks.postFindFirst,
        update: mocks.postUpdate,
      },
      postBookmark: {
        findUnique: mocks.bookmarkFindUnique,
        create: mocks.bookmarkCreate,
        count: mocks.bookmarkCount,
      },
      postLike: { count: mocks.likeCount },
      bookmarkCollectionItem: { upsert: mocks.itemUpsert },
    }),
  );
  mocks.getTrustTier.mockResolvedValue("TRUSTED");
  mocks.rankScoreForCounts.mockReturnValue(31);
  mocks.likeCount.mockResolvedValue(2);
  mocks.bookmarkCount.mockResolvedValue(3);
});

describe("bookmark collection membership routes", () => {
  it("does not add a post when the collection is not owned by the viewer", async () => {
    mocks.collectionFindFirst.mockResolvedValue(null);

    const response = await addCollectionItem(itemRequest("POST"), {
      params: Promise.resolve({ id: "collection-1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(mocks.collectionFindFirst).toHaveBeenCalledWith({
      where: { id: "collection-1", userId: "user-1" },
      select: { id: true },
    });
    expect(mocks.postFindFirst).not.toHaveBeenCalled();
    expect(mocks.itemUpsert).not.toHaveBeenCalled();
  });

  it("creates the canonical bookmark once and adds the collection membership", async () => {
    const createdAt = new Date("2026-08-04T08:00:00.000Z");
    mocks.collectionFindFirst.mockResolvedValue({ id: "collection-1" });
    const publishedAt = new Date("2026-08-04T07:00:00.000Z");
    mocks.postFindFirst.mockResolvedValue({
      id: "post-1",
      likeCount: 2,
      bookmarkCount: 4,
      commentCount: 5,
      derivedCount: 1,
      publishedAt,
    });
    mocks.bookmarkFindUnique.mockResolvedValue(null);
    mocks.bookmarkCreate.mockResolvedValue({
      postId: "post-1",
      userId: "user-1",
    });
    mocks.postUpdate.mockResolvedValue({ id: "post-1" });
    mocks.itemUpsert.mockResolvedValue({
      collectionId: "collection-1",
      postId: "post-1",
      createdAt,
    });

    const response = await addCollectionItem(itemRequest("POST"), {
      params: Promise.resolve({ id: "collection-1" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        item: {
          collectionId: "collection-1",
          postId: "post-1",
          createdAt: createdAt.toISOString(),
        },
      },
    });
    expect(mocks.postFindFirst).toHaveBeenCalledWith({
      where: { id: "post-1", status: "PUBLISHED", deletedAt: null },
      select: {
        id: true,
        likeCount: true,
        bookmarkCount: true,
        commentCount: true,
        derivedCount: true,
        publishedAt: true,
      },
    });
    expect(mocks.bookmarkCreate).toHaveBeenCalledWith({
      data: {
        postId: "post-1",
        userId: "user-1",
        countsForRank: true,
      },
    });
    expect(mocks.postUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "post-1" },
      data: { bookmarkCount: { increment: 1 } },
    });
    expect(mocks.postUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: "post-1" },
      data: { rankScore: 31 },
    });
    expect(mocks.rankScoreForCounts).toHaveBeenCalledWith({
      likes: 2,
      bookmarks: 3,
      comments: 5,
      derived: 1,
      publishedAt,
    });
    expect(mocks.itemUpsert).toHaveBeenCalledWith({
      where: {
        collectionId_postId: {
          collectionId: "collection-1",
          postId: "post-1",
        },
      },
      create: { collectionId: "collection-1", postId: "post-1" },
      update: {},
      select: { collectionId: true, postId: true, createdAt: true },
    });
  });

  it("scopes collection item removal through the collection owner", async () => {
    mocks.itemDeleteMany.mockResolvedValue({ count: 0 });

    const response = await removeCollectionItem(itemRequest("DELETE"), {
      params: Promise.resolve({ id: "collection-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.itemDeleteMany).toHaveBeenCalledWith({
      where: {
        collectionId: "collection-1",
        postId: "post-1",
        collection: { userId: "user-1" },
      },
    });
  });
});
