import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    designPost: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
    },
  },
}));

import { GET } from "@/app/api/inspiration/posts/[id]/lineage/route";

const parent = {
  id: "parent",
  title: "原始观察",
  authorNameSnapshot: "林一",
  shape: "PATTERN",
  discipline: "GRAPHIC",
  derivedFromPostId: null,
};

const child = {
  id: "child",
  title: "继续推演",
  authorNameSnapshot: "周二",
  shape: "QUESTION",
  discipline: "GRAPHIC",
  derivedFromPostId: "parent",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inspiration lineage route", () => {
  it("walks up to the visible ancestor before collecting descendants", async () => {
    mocks.findFirst.mockResolvedValueOnce(child).mockResolvedValueOnce(parent);
    mocks.findMany.mockResolvedValueOnce([child]).mockResolvedValueOnce([]);

    const response = await GET(
      new Request("https://chugao.test/api/inspiration/posts/child/lineage"),
      { params: Promise.resolve({ id: "child" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        rootId: "parent",
        nodes: [
          { id: "parent", authorName: "林一" },
          { id: "child", authorName: "周二" },
        ],
        edges: [{ from: "parent", to: "child" }],
      },
    });
  });

  it("deduplicates repeated nodes and edges", async () => {
    mocks.findFirst.mockResolvedValueOnce(parent);
    mocks.findMany
      .mockResolvedValueOnce([child, child])
      .mockResolvedValueOnce([]);

    const response = await GET(
      new Request("https://chugao.test/api/inspiration/posts/parent/lineage"),
      { params: Promise.resolve({ id: "parent" }) },
    );
    const payload = await response.json();

    expect(payload.data.nodes).toHaveLength(2);
    expect(payload.data.edges).toEqual([{ from: "parent", to: "child" }]);
  });
});
