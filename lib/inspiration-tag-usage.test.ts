import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postTagCount: vi.fn(),
  designTagUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    postTag: { count: mocks.postTagCount },
    designTag: {
      update: mocks.designTagUpdate,
      upsert: vi.fn(),
    },
  },
}));

import { syncTagUsageCounts } from "@/lib/inspiration";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.postTagCount.mockResolvedValue(7);
  mocks.designTagUpdate.mockResolvedValue({ id: "tag-1", usageCount: 7 });
});

describe("design tag usage counters", () => {
  it("counts only visible published posts and deduplicates tag ids", async () => {
    await syncTagUsageCounts(["tag-1", "tag-1"]);

    expect(mocks.postTagCount).toHaveBeenCalledOnce();
    expect(mocks.postTagCount).toHaveBeenCalledWith({
      where: {
        tagId: "tag-1",
        post: { status: "PUBLISHED", deletedAt: null },
      },
    });
    expect(mocks.designTagUpdate).toHaveBeenCalledWith({
      where: { id: "tag-1" },
      data: { usageCount: 7 },
    });
  });
});
