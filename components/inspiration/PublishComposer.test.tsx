import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui";

import { inspirationRequest } from "./api";
import { savePublishPreload } from "./publish-preload";
import { PublishComposer } from "./PublishComposer";
import type { InspirationPost } from "./types";

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  push: vi.fn(),
  refresh: vi.fn(),
  listGenerations: vi.fn(),
  getPpt: vi.fn(),
  uploadReferenceImage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/studio/lib/api", () => ({
  getPpt: mocks.getPpt,
  listGenerations: mocks.listGenerations,
  uploadReferenceImage: mocks.uploadReferenceImage,
}));

vi.mock("./api", () => ({ inspirationRequest: vi.fn() }));

function inspirationPost(
  overrides: Partial<InspirationPost> = {},
): InspirationPost {
  return {
    id: "post-1",
    author: { id: "user-1", name: "设计师" },
    shape: "WORK",
    shapeLabel: "作品",
    discipline: "GRAPHIC",
    disciplineLabel: "视觉平面",
    title: "草稿标题",
    story: "设计说明",
    origin: "ORIGINAL",
    originLabel: "原创",
    sourceType: "STANDARD",
    sourceTypeLabel: "常规发布",
    externalUrl: null,
    sourceNote: null,
    promptVisibility: "STRUCTURE_ONLY",
    status: "DRAFT",
    hasMedia: false,
    counts: { likes: 0, bookmarks: 0, comments: 0, derived: 0 },
    publishedAt: null,
    createdAt: "2026-08-04T01:00:00.000Z",
    updatedAt: "2026-08-04T01:00:00.000Z",
    media: [],
    tags: [],
    dailyPrompt: null,
    viewer: {
      isAuthor: true,
      isLiked: false,
      isBookmarked: false,
    },
    ...overrides,
  };
}

function generationPage() {
  return {
    items: [
      {
        id: "generation-1",
        conversationId: null,
        modelId: "model-1",
        prompt: "生成历史作品",
        negativePrompt: null,
        aspectRatio: "1:1",
        resolution: "1024x1024",
        n: 1,
        outputFormat: "png",
        referenceImageKeys: [],
        status: "SUCCEEDED",
        provider: null,
        providerChannelId: null,
        providerChannelName: null,
        providerAccountName: null,
        progress: 100,
        errorCode: null,
        errorMessage: null,
        credits: 1,
        costCredits: 1,
        attempts: 1,
        startedAt: "2026-08-04T01:00:00.000Z",
        finishedAt: "2026-08-04T01:01:00.000Z",
        createdAt: "2026-08-04T01:00:00.000Z",
        images: [
          {
            id: "image-1",
            url: "/image-1.png",
            src: "/image-1.png",
            downloadUrl: "/image-1.png",
            thumbnailUrl: "/image-1-thumb.png",
            width: 1_024,
            height: 1_024,
            mimeType: "image/png",
            createdAt: "2026-08-04T01:01:00.000Z",
          },
        ],
      },
    ],
    nextCursor: null,
  };
}

function renderComposer() {
  return render(
    <ToastProvider>
      <PublishComposer />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = new URLSearchParams();
  mocks.listGenerations.mockResolvedValue({ items: [], nextCursor: null });
  window.sessionStorage.clear();
});

describe("PublishComposer editing flow", () => {
  it("clears newly selected images when switching to REFERENCE", async () => {
    const user = userEvent.setup();
    mocks.listGenerations.mockResolvedValue(generationPage());
    renderComposer();

    await user.click(
      await screen.findByRole("button", { name: "生成历史作品" }),
    );
    expect(screen.getByAltText("已选择图片 1")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /参考.*外部好东西/ }));

    expect(screen.queryByAltText("已选择图片 1")).not.toBeInTheDocument();
    expect(
      screen.getByText("参考类型只保存外链与作者手写说明，不附带站内图片。"),
    ).toBeVisible();
  });

  it("saves an empty WORK post as a draft", async () => {
    const user = userEvent.setup();
    vi.mocked(inspirationRequest).mockResolvedValue(
      inspirationPost({ title: "未命名草稿" }),
    );
    renderComposer();

    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => {
      expect(inspirationRequest).toHaveBeenCalledWith(
        "/api/inspiration/posts",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const createCall = vi
      .mocked(inspirationRequest)
      .mock.calls.find(([path]) => path === "/api/inspiration/posts");
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).toMatchObject({
      shape: "WORK",
      title: "未命名草稿",
      sourceType: "STANDARD",
      draft: true,
      media: [],
    });
  });

  it("persists a node-workflow preload as the post source type", async () => {
    const user = userEvent.setup();
    const token = savePublishPreload(
      {
        source: "NODES",
        shape: "QUESTION",
        discipline: "GRAPHIC",
        title: "节点流程观察",
      },
      { token: "nodes-source-test" },
    );
    mocks.searchParams = new URLSearchParams(`preload=${token}`);
    vi.mocked(inspirationRequest).mockResolvedValue(
      inspirationPost({ shape: "QUESTION", title: "节点流程观察" }),
    );
    renderComposer();

    expect(await screen.findByDisplayValue("节点流程观察")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => {
      const createCall = vi
        .mocked(inspirationRequest)
        .mock.calls.find(([path]) => path === "/api/inspiration/posts");
      expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
        sourceType: "NODES",
        shape: "QUESTION",
      });
    });
  });

  it("adds media to a loaded draft and submits a neutral review request", async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams("edit=post-1");
    mocks.listGenerations.mockResolvedValue(generationPage());
    vi.mocked(inspirationRequest).mockImplementation(async (path, init) => {
      if (path === "/api/inspiration/posts/post-1" && !init?.method) {
        return inspirationPost();
      }
      if (path === "/api/inspiration/posts/post-1/media") {
        return { added: 1, total: 1 };
      }
      if (
        path === "/api/inspiration/posts/post-1" &&
        init?.method === "PATCH"
      ) {
        return inspirationPost({
          status: "PUBLISHED",
          hasMedia: true,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    renderComposer();

    expect(await screen.findByDisplayValue("草稿标题")).toBeVisible();
    await user.click(
      await screen.findByRole("button", { name: "生成历史作品" }),
    );
    await user.click(screen.getByRole("button", { name: "提交这份内容" }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/app/inspiration/post-1");
    });
    const mediaCall = vi
      .mocked(inspirationRequest)
      .mock.calls.find(([path]) => path.endsWith("/media"));
    expect(JSON.parse(String(mediaCall?.[1]?.body))).toEqual({
      media: [
        {
          sourceGeneratedImageId: "image-1",
          role: "FINAL",
          isCover: true,
        },
      ],
    });
    const patchCall = vi
      .mocked(inspirationRequest)
      .mock.calls.find(
        ([path, init]) =>
          path === "/api/inspiration/posts/post-1" && init?.method === "PATCH",
      );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      title: "草稿标题",
      status: "PENDING",
    });
  });

  it("keeps existing media out of the append payload when editing a published post", async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams("edit=post-1");
    vi.mocked(inspirationRequest).mockImplementation(async (path, init) => {
      if (path === "/api/inspiration/posts/post-1" && !init?.method) {
        return inspirationPost({
          status: "PUBLISHED",
          hasMedia: true,
          publishedAt: "2026-08-04T01:00:00.000Z",
          media: [
            {
              id: "media-1",
              url: "/media-1.png",
              thumbnailUrl: "/media-1-thumb.png",
              width: 1_024,
              height: 1_024,
              mimeType: "image/png",
              order: 0,
              role: "FINAL",
              isCover: true,
              recipe: null,
            },
          ],
        });
      }
      if (
        path === "/api/inspiration/posts/post-1" &&
        init?.method === "PATCH"
      ) {
        return inspirationPost({ status: "PUBLISHED" });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    renderComposer();

    expect(await screen.findByText("已有图片")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/app/inspiration/post-1");
    });
    expect(
      vi
        .mocked(inspirationRequest)
        .mock.calls.some(([path]) => path.endsWith("/media")),
    ).toBe(false);
    const patchCall = vi
      .mocked(inspirationRequest)
      .mock.calls.find(([, init]) => init?.method === "PATCH");
    const body = JSON.parse(String(patchCall?.[1]?.body));
    expect(body).not.toHaveProperty("status");
  });

  it("does not append the same newly saved media again when the following PATCH must be retried", async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams("edit=post-1");
    mocks.listGenerations.mockResolvedValue(generationPage());
    let patchAttempts = 0;
    vi.mocked(inspirationRequest).mockImplementation(async (path, init) => {
      if (path === "/api/inspiration/posts/post-1" && !init?.method) {
        return inspirationPost();
      }
      if (path === "/api/inspiration/posts/post-1/media") {
        return { added: 1, total: 1 };
      }
      if (
        path === "/api/inspiration/posts/post-1" &&
        init?.method === "PATCH"
      ) {
        patchAttempts += 1;
        if (patchAttempts === 1) throw new Error("正文保存失败");
        return inspirationPost({ status: "PENDING", hasMedia: true });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    renderComposer();

    expect(await screen.findByDisplayValue("草稿标题")).toBeVisible();
    await user.click(
      await screen.findByRole("button", { name: "生成历史作品" }),
    );
    await user.click(screen.getByRole("button", { name: "提交这份内容" }));
    expect(await screen.findByText("正文保存失败")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "提交这份内容" }));
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/app/inspiration?view=mine");
    });

    expect(
      vi
        .mocked(inspirationRequest)
        .mock.calls.filter(([path]) => path.endsWith("/media")),
    ).toHaveLength(1);
    expect(patchAttempts).toBe(2);
  });

  it("never falls back to creating a new post when edit loading fails", async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams("edit=missing-post");
    vi.mocked(inspirationRequest).mockRejectedValue(new Error("帖子不存在"));
    renderComposer();

    expect(await screen.findByText("无法载入这条内容")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "保存草稿" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回我的灵感" }));

    expect(mocks.push).toHaveBeenCalledWith("/app/inspiration?view=mine");
    expect(
      vi
        .mocked(inspirationRequest)
        .mock.calls.some(
          ([path, init]) =>
            path === "/api/inspiration/posts" && init?.method === "POST",
        ),
    ).toBe(false);
  });
});
