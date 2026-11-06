import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  dailyFindFirst: vi.fn(),
  followFindUnique: vi.fn(),
  serializePostsForViewer: vi.fn(
    async (posts: Array<{ id: string }>) => posts.map((post) => ({ id: post.id })),
  ),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: {
    dailyPrompt: { findFirst: mocks.dailyFindFirst },
    userFollow: { findUnique: mocks.followFindUnique },
  },
}));

vi.mock("@/lib/inspiration", () => ({
  dayKey: () => "2026-08-04",
  postInclude: {},
  serializePostsForViewer: mocks.serializePostsForViewer,
}));

import { GET } from "@/app/api/inspiration/daily/route";

function post(id: string, status: "PUBLISHED" | "HIDDEN", deletedAt: Date | null = null) {
  return { id, status, deletedAt };
}

function dailyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "daily-1",
    day: new Date("2026-08-04T00:00:00.000Z"),
    discipline: "GRAPHIC",
    title: "今日命题",
    prompt: "观察一种日常秩序",
    keywords: ["秩序"],
    publishedAt: new Date("2026-08-04T01:00:00.000Z"),
    questionPost: null,
    features: [],
    responses: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue({ status: "unauthenticated" });
  mocks.followFindUnique.mockResolvedValue(null);
});

describe("public daily inspiration route", () => {
  it("filters hidden or deleted featured posts before serializing the response", async () => {
    mocks.dailyFindFirst.mockResolvedValue(
      dailyRow({
        features: [
          { post: post("published", "PUBLISHED") },
          { post: post("hidden", "HIDDEN") },
          { post: post("deleted", "PUBLISHED", new Date()) },
        ],
      }),
    );

    const response = await GET(
      new Request("https://chugao.test/api/inspiration/daily?day=2026-08-04"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { prompt: { features: [{ id: "published" }] } },
    });
    expect(mocks.serializePostsForViewer).toHaveBeenCalledTimes(1);
    expect(mocks.dailyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          features: expect.objectContaining({
            where: { post: { status: "PUBLISHED", deletedAt: null } },
          }),
        }),
      }),
    );
  });

  it("does not return an official question after that post is hidden", async () => {
    mocks.dailyFindFirst.mockResolvedValue(
      dailyRow({ questionPost: post("official-question", "HIDDEN") }),
    );

    const response = await GET(
      new Request("https://chugao.test/api/inspiration/daily?day=2026-08-04"),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { prompt: { questionPost: null } },
    });
    expect(mocks.serializePostsForViewer).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "official-question" })],
      null,
    );
  });
});
