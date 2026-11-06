import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  getTrustTier: vi.fn(),
  postFindUnique: vi.fn(),
  transaction: vi.fn(),
  postUpdate: vi.fn(),
  parentFindUnique: vi.fn(),
  promptBlocked: vi.fn(),
  syncTagUsageCounts: vi.fn(),
  serializePost: vi.fn(
    (row: { id: string; status: string; trustTier: string }) => ({
      id: row.id,
      status: row.status,
      trustTier: row.trustTier,
    }),
  ),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: {
    designPost: { findUnique: mocks.postFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/inspiration", async () => {
  const { z } = await import("zod");
  return {
    ensureTags: vi.fn(),
    getTrustTier: mocks.getTrustTier,
    httpUrlSchema: z.string().url(),
    postInclude: {},
    rankScoreForCounts: () => 17,
    serializePost: mocks.serializePost,
    syncTagUsageCounts: mocks.syncTagUsageCounts,
  };
});

vi.mock("@/lib/inspiration-moderation", () => ({
  isInspirationTextBlocked: mocks.promptBlocked,
}));

import { DELETE, PATCH } from "@/app/api/inspiration/posts/[id]/route";

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
    trustTier: "NEW" | "TRUSTED" | "RESTRICTED";
    mediaCount: number;
    derivedFromPostId: string | null;
  }> = {},
) {
  return {
    id: "post-1",
    authorId: user.id,
    authorNameSnapshot: "设计师",
    shape: "WORK",
    discipline: "GRAPHIC",
    title: "原始标题",
    story: null,
    origin: "ORIGINAL",
    externalUrl: null,
    sourceNote: null,
    promptVisibility: "STRUCTURE_ONLY",
    status: overrides.status ?? "DRAFT",
    trustTier: overrides.trustTier ?? "NEW",
    moderationNote: null,
    derivedFromPostId: overrides.derivedFromPostId ?? null,
    dailyPromptId: null,
    hasMedia: (overrides.mediaCount ?? 0) > 0,
    likeCount: 1,
    bookmarkCount: 2,
    commentCount: 3,
    derivedCount: 4,
    rankScore: 0,
    publishedAt:
      overrides.status === "PUBLISHED"
        ? new Date("2026-08-01T02:00:00.000Z")
        : null,
    hiddenAt: null,
    deletedAt: null,
    createdAt: new Date("2026-08-01T01:00:00.000Z"),
    updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    media: Array.from({ length: overrides.mediaCount ?? 0 }, (_, index) => ({
      id: `media-${index + 1}`,
    })),
    tags: [],
  };
}

function patchRequest(body: Record<string, unknown>) {
  return PATCH(
    new Request("https://chugao.test/api/inspiration/posts/post-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "post-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue({ status: "authenticated", user });
  mocks.getTrustTier.mockResolvedValue("NEW");
  mocks.promptBlocked.mockResolvedValue(false);
  mocks.parentFindUnique.mockResolvedValue(null);
  mocks.postUpdate.mockImplementation(async ({ where, data }) => ({
    ...post(),
    id: where.id,
    ...data,
  }));
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      designPost: {
        update: mocks.postUpdate,
        findUnique: mocks.parentFindUnique,
      },
      postTag: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    }),
  );
});

describe("inspiration post editing", () => {
  it("does not convert an image post into a REFERENCE post", async () => {
    mocks.postFindUnique.mockResolvedValue(post({ mediaCount: 1 }));

    const response = await patchRequest({
      shape: "REFERENCE",
      externalUrl: "https://example.com/reference",
      sourceNote: "手写推荐理由",
    });

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("saves an empty WORK post as a draft", async () => {
    mocks.postFindUnique.mockResolvedValue(post());

    const response = await patchRequest({
      title: "未完成作品",
      status: "DRAFT",
    });

    expect(response.status).toBe(200);
    expect(mocks.postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "post-1" },
        data: expect.objectContaining({ status: "DRAFT" }),
      }),
    );
  });

  it("submits a NEW author's completed draft for review", async () => {
    mocks.postFindUnique.mockResolvedValue(post({ mediaCount: 1 }));
    mocks.getTrustTier.mockResolvedValue("NEW");

    const response = await patchRequest({
      title: "完整作品",
      status: "PENDING",
    });

    expect(response.status).toBe(200);
    expect(mocks.postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          trustTier: "NEW",
          publishedAt: null,
          rankScore: 0,
        }),
      }),
    );
  });

  it("publishes a TRUSTED author's completed draft from the same submission request", async () => {
    mocks.postFindUnique.mockResolvedValue(
      post({ mediaCount: 1, trustTier: "NEW" }),
    );
    mocks.getTrustTier.mockResolvedValue("TRUSTED");

    const response = await patchRequest({
      title: "完整作品",
      status: "PENDING",
    });

    expect(response.status).toBe(200);
    expect(mocks.postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PUBLISHED",
          trustTier: "TRUSTED",
          publishedAt: expect.any(Date),
          rankScore: 17,
        }),
      }),
    );
  });

  it("normalizes a stale publish request from a RESTRICTED draft to PENDING", async () => {
    mocks.postFindUnique.mockResolvedValue(
      post({ mediaCount: 1, trustTier: "TRUSTED" }),
    );
    mocks.getTrustTier.mockResolvedValue("RESTRICTED");

    const response = await patchRequest({
      title: "完整作品",
      status: "PUBLISHED",
    });

    expect(response.status).toBe(200);
    expect(mocks.postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          trustTier: "RESTRICTED",
        }),
      }),
    );
  });

  it("moves edits by a RESTRICTED author from PUBLISHED back to PENDING", async () => {
    const originalPublishedAt = new Date("2026-08-01T02:00:00.000Z");
    mocks.postFindUnique.mockResolvedValue(
      post({ status: "PUBLISHED", mediaCount: 1, trustTier: "TRUSTED" }),
    );
    mocks.getTrustTier.mockResolvedValue("RESTRICTED");

    const response = await patchRequest({ title: "重新修改的标题" });

    expect(response.status).toBe(200);
    expect(mocks.postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          trustTier: "RESTRICTED",
          publishedAt: originalPublishedAt,
          rankScore: 0,
        }),
      }),
    );
  });

  it("keeps a TRUSTED author's published edit public", async () => {
    mocks.postFindUnique.mockResolvedValue(
      post({ status: "PUBLISHED", mediaCount: 1, trustTier: "TRUSTED" }),
    );
    mocks.getTrustTier.mockResolvedValue("TRUSTED");

    const response = await patchRequest({ title: "公开更新的标题" });

    expect(response.status).toBe(200);
    expect(mocks.postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PUBLISHED",
          trustTier: "TRUSTED",
          rankScore: 17,
        }),
      }),
    );
  });
});

describe("inspiration post deletion", () => {
  it("soft-deletes an authored post without removing it from storage immediately", async () => {
    mocks.postFindUnique.mockResolvedValue(
      post({ status: "PUBLISHED", mediaCount: 1 }),
    );

    const response = await DELETE(
      new Request("https://chugao.test/api/inspiration/posts/post-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "post-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { deleted: true, mediaRetentionDays: 30 },
    });
    expect(mocks.postUpdate).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: {
        deletedAt: expect.any(Date),
        status: "HIDDEN",
        hiddenAt: expect.any(Date),
        rankScore: 0,
      },
    });
  });
});
