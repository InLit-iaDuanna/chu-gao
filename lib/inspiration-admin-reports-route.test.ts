import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const contentReportFindUnique = vi.fn();
  const contentReportUpdate = vi.fn();
  const designPostFindUnique = vi.fn();
  const designPostUpdate = vi.fn();
  const designPostUpdateMany = vi.fn();
  const postCommentFindUnique = vi.fn();
  const postCommentUpdateMany = vi.fn();
  const transaction = vi.fn();

  const tx = {
    contentReport: {
      findUnique: contentReportFindUnique,
      update: contentReportUpdate,
    },
    designPost: {
      findUnique: designPostFindUnique,
      update: designPostUpdate,
      updateMany: designPostUpdateMany,
    },
    postComment: {
      findUnique: postCommentFindUnique,
      updateMany: postCommentUpdateMany,
    },
  };

  return {
    audit: vi.fn(),
    checkSession: vi.fn(),
    contentReportFindUnique,
    contentReportUpdate,
    designPostFindUnique,
    designPostUpdate,
    designPostUpdateMany,
    postCommentFindUnique,
    postCommentUpdateMany,
    rankScoreForCounts: vi.fn(() => 42.5),
    transaction,
    tx,
  };
});

vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

vi.mock("@/lib/auth", () => ({
  checkSession: mocks.checkSession,
  adminFailureResponse: (result: {
    status: string;
    user?: { role: string };
  }) =>
    result.status === "authenticated" && result.user?.role === "ADMIN"
      ? null
      : new Response(null, { status: 401 }),
  authenticatedUser: (result: { user: unknown }) => result.user,
}));

vi.mock("@/lib/db", () => ({
  db: { $transaction: mocks.transaction },
}));

vi.mock("@/lib/inspiration", () => ({
  rankScoreForCounts: mocks.rankScoreForCounts,
}));

import { PATCH } from "@/app/api/admin/inspiration/reports/[id]/route";

const now = new Date("2026-08-04T08:00:00.000Z");
const admin = {
  id: "admin-1",
  email: "admin@example.com",
  role: "ADMIN" as const,
  status: "ACTIVE" as const,
  sessionVersion: 1,
};

function reviewRequest(overrides: Record<string, unknown> = {}) {
  return new Request(
    "https://chugao.test/api/admin/inspiration/reports/report-1",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://chugao.test",
      },
      body: JSON.stringify({
        status: "RESOLVED",
        resolution: "举报成立",
        hideTarget: true,
        ...overrides,
      }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.checkSession.mockResolvedValue({
    status: "authenticated",
    user: admin,
  });
  mocks.transaction.mockImplementation(
    async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
  );
  mocks.contentReportUpdate.mockResolvedValue({
    id: "report-1",
    status: "RESOLVED",
  });
  mocks.audit.mockResolvedValue(undefined);
  mocks.rankScoreForCounts.mockReturnValue(42.5);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("admin inspiration report review route", () => {
  it("rejects contradictory dismissal and hide instructions", async () => {
    const response = await PATCH(
      reviewRequest({ status: "DISMISSED", hideTarget: true }),
      { params: Promise.resolve({ id: "report-1" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("dismisses a report without changing its target", async () => {
    mocks.contentReportFindUnique.mockResolvedValue({
      id: "report-1",
      postId: "post-1",
      commentId: null,
    });

    const response = await PATCH(
      reviewRequest({
        status: "DISMISSED",
        resolution: "未发现违规",
        hideTarget: false,
      }),
      { params: Promise.resolve({ id: "report-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.designPostFindUnique).not.toHaveBeenCalled();
    expect(mocks.contentReportUpdate).toHaveBeenCalledWith({
      where: { id: "report-1" },
      data: {
        status: "DISMISSED",
        resolution: "未发现违规",
        reviewerId: "admin-1",
        reviewedAt: now,
      },
    });
  });

  it("decrements and reranks the parent when a published derived post is hidden", async () => {
    const publishedAt = new Date("2026-08-03T08:00:00.000Z");
    mocks.contentReportFindUnique.mockResolvedValue({
      id: "report-1",
      postId: "derived-1",
      commentId: null,
    });
    mocks.designPostFindUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === "derived-1"
          ? { derivedFromPostId: "parent-1", hiddenAt: null }
          : {
              id: "parent-1",
              likeCount: 4,
              bookmarkCount: 3,
              commentCount: 2,
              derivedCount: 1,
              publishedAt,
            },
    );
    mocks.designPostUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.designPostUpdate.mockResolvedValue({ id: "parent-1" });

    const response = await PATCH(reviewRequest(), {
      params: Promise.resolve({ id: "report-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.designPostUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "derived-1", status: "PUBLISHED" },
      data: {
        status: "HIDDEN",
        hiddenAt: now,
        moderationNote: "举报成立",
        rankScore: 0,
      },
    });
    expect(mocks.designPostUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "parent-1", derivedCount: { gt: 0 } },
      data: { derivedCount: { decrement: 1 } },
    });
    expect(mocks.rankScoreForCounts).toHaveBeenCalledWith({
      likes: 4,
      bookmarks: 3,
      comments: 2,
      derived: 1,
      publishedAt,
    });
    expect(mocks.designPostUpdate).toHaveBeenCalledWith({
      where: { id: "parent-1" },
      data: { rankScore: 42.5 },
    });
  });

  it("decrements the post comment count and reranks after deleting a reported comment", async () => {
    const publishedAt = new Date("2026-08-02T08:00:00.000Z");
    mocks.contentReportFindUnique.mockResolvedValue({
      id: "report-1",
      postId: null,
      commentId: "comment-1",
    });
    mocks.postCommentFindUnique.mockResolvedValue({
      postId: "post-1",
      deletedAt: null,
    });
    mocks.postCommentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.designPostUpdateMany.mockResolvedValue({ count: 1 });
    mocks.designPostFindUnique.mockResolvedValue({
      id: "post-1",
      likeCount: 5,
      bookmarkCount: 2,
      commentCount: 1,
      derivedCount: 3,
      publishedAt,
    });
    mocks.designPostUpdate.mockResolvedValue({ id: "post-1" });

    const response = await PATCH(reviewRequest(), {
      params: Promise.resolve({ id: "report-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.postCommentUpdateMany).toHaveBeenCalledWith({
      where: { id: "comment-1", deletedAt: null },
      data: { deletedAt: now },
    });
    expect(mocks.designPostUpdateMany).toHaveBeenCalledWith({
      where: { id: "post-1", commentCount: { gt: 0 } },
      data: { commentCount: { decrement: 1 } },
    });
    expect(mocks.rankScoreForCounts).toHaveBeenCalledWith({
      likes: 5,
      bookmarks: 2,
      comments: 1,
      derived: 3,
      publishedAt,
    });
    expect(mocks.designPostUpdate).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: { rankScore: 42.5 },
    });
  });

  it("does not decrement the parent again when the reported post is already hidden", async () => {
    mocks.contentReportFindUnique.mockResolvedValue({
      id: "report-1",
      postId: "derived-1",
      commentId: null,
    });
    mocks.designPostFindUnique.mockResolvedValue({
      derivedFromPostId: "parent-1",
      hiddenAt: new Date("2026-08-04T07:00:00.000Z"),
    });
    mocks.designPostUpdateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const response = await PATCH(reviewRequest(), {
      params: Promise.resolve({ id: "report-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.designPostUpdateMany).toHaveBeenCalledTimes(2);
    expect(mocks.designPostUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "parent-1", derivedCount: { gt: 0 } },
      }),
    );
    expect(mocks.designPostUpdate).not.toHaveBeenCalled();
    expect(mocks.rankScoreForCounts).not.toHaveBeenCalled();
  });

  it("does not decrement the post again when the reported comment was already deleted", async () => {
    mocks.contentReportFindUnique.mockResolvedValue({
      id: "report-1",
      postId: null,
      commentId: "comment-1",
    });
    mocks.postCommentFindUnique.mockResolvedValue({
      postId: "post-1",
      deletedAt: new Date("2026-08-04T07:00:00.000Z"),
    });

    const response = await PATCH(reviewRequest(), {
      params: Promise.resolve({ id: "report-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.postCommentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.designPostUpdateMany).not.toHaveBeenCalled();
    expect(mocks.designPostUpdate).not.toHaveBeenCalled();
    expect(mocks.rankScoreForCounts).not.toHaveBeenCalled();
  });
});
