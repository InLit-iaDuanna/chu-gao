import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  postFindMany: vi.fn(),
  likeGroupBy: vi.fn(),
  bookmarkGroupBy: vi.fn(),
  followFindMany: vi.fn(),
  viewerLikesFindMany: vi.fn(),
  viewerBookmarksFindMany: vi.fn(),
  rankScoreForCounts: vi.fn(
    (input: {
      likes: number;
      bookmarks: number;
      comments: number;
      derived: number;
    }) =>
      input.likes +
      input.bookmarks * 2 +
      input.comments * 3 +
      input.derived * 5,
  ),
  serializePost: vi.fn(
    (row: { id: string }, viewer?: { id: string } | null) => ({
      id: row.id,
      viewer: {
        isAuthor: viewer?.id === `author-${row.id}`,
        isLiked: false,
        isBookmarked: false,
      },
    }),
  ),
}));

vi.mock("@/lib/auth", () => ({
  authenticatedUser: vi.fn(),
  checkSession: mocks.checkSession,
}));

vi.mock("@/lib/db", () => ({
  db: {
    designPost: { findMany: mocks.postFindMany },
    postLike: {
      groupBy: mocks.likeGroupBy,
      findMany: mocks.viewerLikesFindMany,
    },
    postBookmark: {
      groupBy: mocks.bookmarkGroupBy,
      findMany: mocks.viewerBookmarksFindMany,
    },
    userFollow: { findMany: mocks.followFindMany },
  },
}));

vi.mock("@/lib/inspiration", () => ({
  consumePostQuota: vi.fn(),
  dayKey: vi.fn(),
  DISCIPLINE_LABELS: {
    GRAPHIC: "视觉平面",
    PRODUCT: "产品体验",
    INDUSTRIAL: "工业硬件",
    SERVICE: "服务流程",
    SPATIAL: "空间环境",
    BRAND: "品牌策略",
    MOTION: "动态影像",
    DATAVIZ: "信息可视化",
  },
  ensureTags: vi.fn(),
  getTrustTier: vi.fn(),
  postCreateSchema: { safeParse: vi.fn() },
  postInclude: {},
  publicRecipeSnapshot: vi.fn(),
  rankScoreForCounts: mocks.rankScoreForCounts,
  serializePost: mocks.serializePost,
  SHAPE_LABELS: {
    WORK: "作品",
    TEARDOWN: "拆解",
    PATTERN: "模式",
    QUESTION: "命题",
    REFERENCE: "参考",
    PROCESS: "过程",
  },
}));

import { GET } from "@/app/api/inspiration/posts/route";

const viewer = {
  id: "viewer-1",
  email: "viewer@example.com",
  role: "USER" as const,
  status: "ACTIVE" as const,
  sessionVersion: 1,
};

const originalDatabaseUrl = process.env.DATABASE_URL;

function candidate(
  id: string,
  overrides: Partial<{
    authorId: string;
    discipline: "GRAPHIC" | "PRODUCT";
    commentCount: number;
    derivedCount: number;
    tagIds: string[];
    publishedAt: Date;
  }> = {},
) {
  return {
    id,
    authorId: overrides.authorId ?? `author-${id}`,
    discipline: overrides.discipline ?? "GRAPHIC",
    commentCount: overrides.commentCount ?? 0,
    derivedCount: overrides.derivedCount ?? 0,
    publishedAt: overrides.publishedAt ?? new Date("2026-08-04T00:00:00.000Z"),
    rankScore: 999,
    tags: (overrides.tagIds ?? []).map((tagId) => ({ tagId })),
  };
}

function request(query: string) {
  return new Request(`https://chugao.test/api/inspiration/posts?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgresql://test.invalid/inspiration";
  mocks.checkSession.mockResolvedValue({ status: "unauthenticated" });
  mocks.postFindMany.mockResolvedValue([]);
  mocks.likeGroupBy.mockResolvedValue([]);
  mocks.bookmarkGroupBy.mockResolvedValue([]);
  mocks.followFindMany.mockResolvedValue([]);
  mocks.viewerLikesFindMany.mockResolvedValue([]);
  mocks.viewerBookmarksFindMany.mockResolvedValue([]);
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("inspiration posts list route", () => {
  it("ranks hot posts from trusted likes and bookmarks rather than stored public counters", async () => {
    mocks.postFindMany.mockResolvedValue([
      candidate("trusted"),
      candidate("untrusted", { commentCount: 1 }),
    ]);
    mocks.likeGroupBy.mockResolvedValue([
      { postId: "trusted", _count: { _all: 2 } },
    ]);
    mocks.bookmarkGroupBy.mockResolvedValue([
      { postId: "trusted", _count: { _all: 1 } },
    ]);

    const response = await GET(request("tab=hot&limit=2"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.items.map((item: { id: string }) => item.id)).toEqual([
      "trusted",
      "untrusted",
    ]);
    expect(payload.data.items[0]).not.toHaveProperty("rankScore");
    expect(payload.data.items[1]).not.toHaveProperty("rankScore");
    expect(mocks.likeGroupBy).toHaveBeenCalledWith({
      by: ["postId"],
      where: {
        postId: { in: ["trusted", "untrusted"] },
        countsForRank: true,
      },
      _count: { _all: true },
    });
    expect(mocks.bookmarkGroupBy).toHaveBeenCalledWith({
      by: ["postId"],
      where: {
        postId: { in: ["trusted", "untrusted"] },
        countsForRank: true,
      },
      _count: { _all: true },
    });
  });

  it("applies followed user, discipline, and tag boosts only to recommended ordering", async () => {
    mocks.checkSession.mockResolvedValue({
      status: "authenticated",
      user: viewer,
    });
    mocks.postFindMany.mockResolvedValue([
      candidate("organic", { commentCount: 4 }),
      candidate("personal", {
        authorId: "followed-user",
        discipline: "PRODUCT",
        tagIds: ["followed-tag"],
      }),
    ]);
    mocks.followFindMany.mockResolvedValue([
      { targetType: "USER", targetKey: "followed-user" },
      { targetType: "DISCIPLINE", targetKey: "PRODUCT" },
      { targetType: "TAG", targetKey: "followed-tag" },
    ]);

    const response = await GET(request("tab=recommended&limit=2"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.items.map((item: { id: string }) => item.id)).toEqual([
      "personal",
      "organic",
    ]);
    expect(mocks.followFindMany).toHaveBeenCalledWith({
      where: { followerId: viewer.id },
    });

    mocks.followFindMany.mockClear();
    const hotResponse = await GET(request("tab=hot&limit=2"));
    const hotPayload = await hotResponse.json();
    expect(
      hotPayload.data.items.map((item: { id: string }) => item.id),
    ).toEqual(["organic", "personal"]);
    expect(mocks.followFindMany).not.toHaveBeenCalled();
  });

  it("continues after a known dynamic cursor and ends on an unknown or expired cursor", async () => {
    mocks.postFindMany.mockResolvedValue([
      candidate("first", { derivedCount: 3 }),
      candidate("second", { derivedCount: 2 }),
      candidate("third", { derivedCount: 1 }),
    ]);

    const knownResponse = await GET(request("tab=hot&limit=1&cursor=first"));
    const knownPayload = await knownResponse.json();
    expect(
      knownPayload.data.items.map((item: { id: string }) => item.id),
    ).toEqual(["second"]);
    expect(knownPayload.data.nextCursor).toBe("second");

    const staleResponse = await GET(request("tab=hot&limit=1&cursor=missing"));
    const stalePayload = await staleResponse.json();
    expect(staleResponse.status).toBe(200);
    expect(stalePayload.data.items).toEqual([]);
    expect(stalePayload.data.nextCursor).toBeNull();
  });

  it("keeps latest on database cursor pagination without rank aggregation", async () => {
    mocks.postFindMany.mockResolvedValue([
      candidate("second"),
      candidate("third"),
      candidate("extra"),
    ]);

    const response = await GET(request("tab=latest&limit=2&cursor=first"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.items.map((item: { id: string }) => item.id)).toEqual([
      "second",
      "third",
    ]);
    expect(payload.data.nextCursor).toBe("third");
    expect(mocks.postFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: 3,
        cursor: { id: "first" },
        skip: 1,
      }),
    );
    expect(mocks.likeGroupBy).not.toHaveBeenCalled();
    expect(mocks.bookmarkGroupBy).not.toHaveBeenCalled();
  });

  it.each([
    ["0", 2],
    ["-3", 2],
    ["2.9", 3],
    ["not-a-number", 25],
    ["", 25],
    ["99", 51],
  ])(
    "normalizes limit=%s before passing take=%i to Prisma",
    async (limit, expectedTake) => {
      await GET(request(`tab=latest&limit=${limit}`));

      expect(mocks.postFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: expectedTake }),
      );
    },
  );

  it("keeps following scoped to followed users, valid disciplines, and tags", async () => {
    mocks.checkSession.mockResolvedValue({
      status: "authenticated",
      user: viewer,
    });
    mocks.followFindMany.mockResolvedValue([
      { targetType: "USER", targetKey: "designer-1" },
      { targetType: "DISCIPLINE", targetKey: "PRODUCT" },
      { targetType: "DISCIPLINE", targetKey: "NOT_A_DISCIPLINE" },
      { targetType: "TAG", targetKey: "tag-1" },
    ]);
    mocks.postFindMany.mockResolvedValue([]);

    const response = await GET(request("tab=following"));

    expect(response.status).toBe(200);
    expect(mocks.postFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { authorId: { in: ["designer-1"] } },
                { discipline: { in: ["PRODUCT"] } },
                { tags: { some: { tagId: { in: ["tag-1"] } } } },
              ],
            },
          ],
        }),
      }),
    );
    expect(mocks.likeGroupBy).not.toHaveBeenCalled();
    expect(mocks.bookmarkGroupBy).not.toHaveBeenCalled();
  });

  it("still requires authentication for the following feed", async () => {
    const response = await GET(request("tab=following"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    expect(mocks.followFindMany).not.toHaveBeenCalled();
    expect(mocks.postFindMany).not.toHaveBeenCalled();
  });

  it("returns auth unavailable instead of treating an indeterminate session as logged out", async () => {
    mocks.checkSession.mockResolvedValue({
      status: "unavailable",
      error: new Error("auth database unavailable"),
    });

    const response = await GET(request("tab=following"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_UNAVAILABLE" },
    });
    expect(mocks.followFindMany).not.toHaveBeenCalled();
  });

  it("converts a following lookup failure into the route's JSON error response", async () => {
    mocks.checkSession.mockResolvedValue({
      status: "authenticated",
      user: viewer,
    });
    mocks.followFindMany.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(request("tab=following"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "灵感列表读取失败",
        details: "database unavailable",
      },
    });
    expect(mocks.postFindMany).not.toHaveBeenCalled();
  });
});
