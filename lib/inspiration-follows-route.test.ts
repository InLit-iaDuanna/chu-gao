import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  followFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: {
    userFollow: { findMany: mocks.followFindMany },
  },
}));

import { GET } from "@/app/api/inspiration/follows/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue({
    status: "authenticated",
    user: {
      id: "viewer-1",
      email: "viewer@example.com",
      role: "USER",
      status: "ACTIVE",
      sessionVersion: 1,
    },
  });
});

describe("inspiration follows route", () => {
  it("never selects or serializes a followed user's email", async () => {
    mocks.followFindMany.mockResolvedValue([
      {
        id: "follow-1",
        followerId: "viewer-1",
        targetType: "USER",
        targetKey: "designer-1",
        targetUserId: "designer-1",
        discipline: null,
        tagId: null,
        createdAt: new Date("2026-08-04T00:00:00.000Z"),
        targetUser: {
          id: "designer-1",
          name: "林一",
          email: "private@example.com",
        },
        tag: null,
      },
    ]);

    const response = await GET(
      new Request("https://chugao.test/api/inspiration/follows"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.followFindMany).toHaveBeenCalledWith({
      where: { followerId: "viewer-1" },
      include: {
        targetUser: { select: { id: true, name: true } },
        tag: { select: { id: true, slug: true, name: true, kind: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(payload.data.items[0].targetUser).toEqual({
      id: "designer-1",
      name: "林一",
    });
    expect(JSON.stringify(payload)).not.toContain("private@example.com");
  });
});
