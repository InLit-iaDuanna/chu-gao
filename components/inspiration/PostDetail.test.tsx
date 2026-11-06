import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui";

import { inspirationRequest } from "./api";
import { PostDetail } from "./PostDetail";
import type { InspirationPost } from "./types";

vi.mock("./api", () => ({
  inspirationRequest: vi.fn(),
  InspirationApiError: class InspirationApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  loginForCurrentPage: vi.fn(),
}));

vi.mock("./PostActions", () => ({ PostActions: () => <div>帖子操作</div> }));
vi.mock("./CommentThread", () => ({ CommentThread: () => <div>评论区</div> }));

const post: InspirationPost = {
  id: "post-1",
  author: { id: "author-1", name: "林一" },
  shape: "QUESTION",
  shapeLabel: "命题",
  discipline: "SERVICE",
  disciplineLabel: "服务流程",
  title: "怎样保留有价值的分歧？",
  story: "一次跨学科协作观察。",
  origin: "ORIGINAL",
  originLabel: "原创",
  sourceType: "STANDARD",
  sourceTypeLabel: "常规发布",
  externalUrl: null,
  sourceNote: null,
  promptVisibility: "PRIVATE",
  status: "PUBLISHED",
  hasMedia: false,
  counts: { likes: 0, bookmarks: 0, comments: 0, derived: 0 },
  publishedAt: "2026-08-04T00:00:00.000Z",
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  media: [],
  tags: [
    {
      id: "tag-1",
      slug: "inclusive-design",
      name: "包容性设计",
      kind: "CATEGORY",
      isFollowing: true,
    },
  ],
  dailyPrompt: null,
  viewer: {
    isAuthor: false,
    isLiked: false,
    isBookmarked: false,
    isFollowingAuthor: false,
  },
};

describe("PostDetail tag follows", () => {
  beforeEach(() => {
    vi.mocked(inspirationRequest).mockReset();
  });

  it("shows the initial tag state and can explicitly unfollow", async () => {
    const user = userEvent.setup();
    vi.mocked(inspirationRequest).mockImplementation(async (path) => {
      if (path === "/api/inspiration/posts/post-1") return post;
      if (path === "/api/inspiration/posts/post-1/lineage") {
        return { rootId: "post-1", nodes: [], edges: [] };
      }
      if (path === "/api/inspiration/follows") return { following: false };
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <ToastProvider>
        <PostDetail postId="post-1" basePath="/app/inspiration" />
      </ToastProvider>,
    );

    const button = await screen.findByRole("button", {
      name: "取消关注标签 包容性设计",
    });
    expect(screen.getByRole("link", { name: "返回灵感广场" })).toHaveAttribute(
      "href",
      "/app/inspiration",
    );
    expect(screen.getByRole("link", { name: "#包容性设计" })).toHaveAttribute(
      "href",
      "/app/inspiration?tag=inclusive-design",
    );
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);

    await waitFor(() => {
      expect(inspirationRequest).toHaveBeenCalledWith(
        "/api/inspiration/follows",
        {
          method: "POST",
          body: JSON.stringify({
            targetType: "TAG",
            targetKey: "tag-1",
            following: false,
          }),
        },
      );
    });
    expect(
      await screen.findByRole("button", { name: "关注标签 包容性设计" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
