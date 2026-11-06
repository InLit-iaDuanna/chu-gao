import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  mediaFindMany: vi.fn(),
  copySnapshot: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: {
    designPostMedia: { findMany: mocks.mediaFindMany },
  },
}));

vi.mock("@/lib/storage", () => ({
  copyDesignPostSnapshotToUploadedReference: mocks.copySnapshot,
}));

import { POST } from "@/app/api/inspiration/me/bookmarks/references/route";

const session = {
  status: "authenticated" as const,
  user: {
    id: "collector-1",
    email: "collector@example.com",
    role: "USER" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  },
};

function referencesRequest(mediaIds: string[]) {
  return new Request(
    "https://chugao.test/api/inspiration/me/bookmarks/references",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaIds }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue(session);
});

describe("bookmarked image reference recovery", () => {
  it("copies unique bookmarked snapshots in the requested order", async () => {
    mocks.mediaFindMany.mockResolvedValue([
      {
        id: "media-1",
        storageKey: "design-posts/post-1/original.png",
        mimeType: "image/png",
        postId: "post-1",
      },
      {
        id: "media-2",
        storageKey: "design-posts/post-2/original.webp",
        mimeType: "image/webp",
        postId: "post-2",
      },
    ]);
    mocks.copySnapshot
      .mockResolvedValueOnce({
        storageKey: "uploads/collector-1/reference-2.webp",
        mimeType: "image/webp",
        width: 1200,
        height: 900,
      })
      .mockResolvedValueOnce({
        storageKey: "uploads/collector-1/reference-1.png",
        mimeType: "image/png",
        width: 800,
        height: 1000,
      });

    const response = await POST(
      referencesRequest(["media-2", "media-1", "media-2"]),
    );

    expect(response.status).toBe(200);
    expect(mocks.mediaFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["media-2", "media-1"] },
        deletedAt: null,
        post: {
          status: "PUBLISHED",
          deletedAt: null,
          bookmarks: { some: { userId: "collector-1" } },
        },
      },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        postId: true,
      },
    });
    expect(mocks.copySnapshot).toHaveBeenNthCalledWith(1, {
      sourceKey: "design-posts/post-2/original.webp",
      mimeType: "image/webp",
      userId: "collector-1",
      stableId: "media-2",
    });
    expect(mocks.copySnapshot).toHaveBeenNthCalledWith(2, {
      sourceKey: "design-posts/post-1/original.png",
      mimeType: "image/png",
      userId: "collector-1",
      stableId: "media-1",
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        references: [
          {
            mediaId: "media-2",
            postId: "post-2",
            key: "uploads/collector-1/reference-2.webp",
            previewUrl:
              "/api/upload?key=uploads%2Fcollector-1%2Freference-2.webp",
            mimeType: "image/webp",
            width: 1200,
            height: 900,
          },
          {
            mediaId: "media-1",
            postId: "post-1",
            key: "uploads/collector-1/reference-1.png",
            previewUrl:
              "/api/upload?key=uploads%2Fcollector-1%2Freference-1.png",
            mimeType: "image/png",
            width: 800,
            height: 1000,
          },
        ],
      },
    });
  });

  it("rejects the whole request when any selected image is not bookmarked", async () => {
    mocks.mediaFindMany.mockResolvedValue([
      {
        id: "media-1",
        storageKey: "design-posts/post-1/original.png",
        mimeType: "image/png",
        postId: "post-1",
      },
    ]);

    const response = await POST(
      referencesRequest(["media-1", "media-foreign"]),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(mocks.copySnapshot).not.toHaveBeenCalled();
  });
});
