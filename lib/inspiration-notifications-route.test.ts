import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  commentsFindMany: vi.fn(),
  likesFindMany: vi.fn(),
  derivationsFindMany: vi.fn(),
  readsCreateMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: {
    postComment: { findMany: mocks.commentsFindMany },
    postLike: { findMany: mocks.likesFindMany },
    designPost: { findMany: mocks.derivationsFindMany },
    inspirationNotificationRead: { createMany: mocks.readsCreateMany },
  },
}));

import { PATCH } from "@/app/api/inspiration/notifications/route";

const session = {
  status: "authenticated" as const,
  user: {
    id: "author-1",
    email: "author@example.com",
    role: "USER" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue(session);
  mocks.commentsFindMany.mockResolvedValue([]);
  mocks.likesFindMany.mockResolvedValue([]);
  mocks.derivationsFindMany.mockResolvedValue([]);
  mocks.readsCreateMany.mockResolvedValue({ count: 0 });
});

describe("notification read route", () => {
  it("marks only visible notification ids and removes duplicates", async () => {
    mocks.commentsFindMany.mockResolvedValue([
      {
        id: "comment-1",
        createdAt: new Date("2026-08-04T08:00:00.000Z"),
        authorNameSnapshot: "回应者",
        post: { id: "post-1", title: "材料与记忆" },
        author: { name: "林间", email: "lin@example.com" },
      },
    ]);
    mocks.readsCreateMany.mockResolvedValue({ count: 1 });

    const response = await PATCH(
      new Request("https://chugao.test/api/inspiration/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notificationIds: [
            "comment:comment-1",
            "comment:not-visible",
            "comment:comment-1",
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        marked: 1,
        notificationIds: ["comment:comment-1"],
      },
    });
    expect(mocks.readsCreateMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "author-1",
          notificationKey: "comment:comment-1",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("does not persist a read marker for an id outside the current feed", async () => {
    const response = await PATCH(
      new Request("https://chugao.test/api/inspiration/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationIds: ["like:another-user:post"] }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { marked: 0 },
    });
    expect(mocks.readsCreateMany).not.toHaveBeenCalled();
  });
});
