import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  mediaFindFirst: vi.fn(),
  statStorage: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: { designPostMedia: { findFirst: mocks.mediaFindFirst } },
}));

vi.mock("@/lib/storage", () => ({
  statDesignPostStorageKey: mocks.statStorage,
  createDesignPostReadStream: mocks.createReadStream,
}));

import { GET } from "@/app/api/inspiration/media/[postId]/[mediaId]/route";

const user = {
  id: "author-1",
  email: "author@example.com",
  role: "USER" as const,
  status: "ACTIVE" as const,
  sessionVersion: 1,
};

function media(status: "DRAFT" | "PENDING" | "PUBLISHED" | "HIDDEN") {
  return {
    id: "media-1",
    postId: "post-1",
    storageKey: "design-posts/post-1/1.png",
    thumbnailKey: "design-posts/post-1/1-thumb.webp",
    mimeType: "image/png",
    post: { authorId: user.id, status, deletedAt: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.statStorage.mockResolvedValue({ size: 5 });
  mocks.createReadStream.mockImplementation(() => Readable.from(Buffer.from("image")));
});

describe("inspiration media cache policy", () => {
  it("uses a private no-store response for an authorized draft preview", async () => {
    mocks.checkSession.mockResolvedValue({ status: "authenticated", user });
    mocks.mediaFindFirst.mockResolvedValue(media("DRAFT"));

    const response = await GET(
      new Request("https://chugao.test/api/inspiration/media/post-1/media-1"),
      { params: Promise.resolve({ postId: "post-1", mediaId: "media-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses a short public cache so moderation can revoke published media", async () => {
    mocks.checkSession.mockResolvedValue({ status: "unauthenticated" });
    mocks.mediaFindFirst.mockResolvedValue(media("PUBLISHED"));

    const response = await GET(
      new Request("https://chugao.test/api/inspiration/media/post-1/media-1"),
      { params: Promise.resolve({ postId: "post-1", mediaId: "media-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
    );
  });
});
