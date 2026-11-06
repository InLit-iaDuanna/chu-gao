import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  rateLimit: vi.fn(),
  postFindFirst: vi.fn(),
  commentFindFirst: vi.fn(),
  reportFindFirst: vi.fn(),
  reportCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));
vi.mock("@/lib/api-rate-limit", () => ({
  userActionRateLimitResponse: mocks.rateLimit,
}));
vi.mock("@/lib/db", () => ({
  db: {
    designPost: { findFirst: mocks.postFindFirst },
    postComment: { findFirst: mocks.commentFindFirst },
    contentReport: {
      findFirst: mocks.reportFindFirst,
      create: mocks.reportCreate,
    },
  },
}));

import { POST } from "@/app/api/inspiration/posts/[id]/report/route";

const session = {
  status: "authenticated" as const,
  user: {
    id: "reporter-1",
    email: "reporter@example.com",
    role: "USER" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  },
};

function request(body: Record<string, unknown>) {
  return new Request("https://chugao.test/api/inspiration/posts/post-1/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue(session);
  mocks.rateLimit.mockResolvedValue(null);
  mocks.reportFindFirst.mockResolvedValue(null);
  mocks.reportCreate.mockResolvedValue({ id: "report-1", status: "OPEN" });
});

describe("inspiration report route", () => {
  it("only allows reporting a currently public post", async () => {
    mocks.postFindFirst.mockResolvedValue(null);

    const response = await POST(request({ reason: "SPAM" }), {
      params: Promise.resolve({ id: "post-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.postFindFirst).toHaveBeenCalledWith({
      where: { id: "post-1", status: "PUBLISHED", deletedAt: null },
      select: { id: true, authorId: true },
    });
    expect(mocks.reportCreate).not.toHaveBeenCalled();
  });

  it("rejects reporting your own post", async () => {
    mocks.postFindFirst.mockResolvedValue({
      id: "post-1",
      authorId: "reporter-1",
    });

    const response = await POST(request({ reason: "SPAM" }), {
      params: Promise.resolve({ id: "post-1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_TARGET" },
    });
    expect(mocks.reportFindFirst).not.toHaveBeenCalled();
  });

  it("creates a comment report without also targeting the post", async () => {
    mocks.postFindFirst.mockResolvedValue({ id: "post-1", authorId: "author-1" });
    mocks.commentFindFirst.mockResolvedValue({
      id: "comment-1",
      authorId: "commenter-1",
    });

    const response = await POST(
      request({ reason: "HARASSMENT", commentId: "cmsejtt1g000u3y9wd3cy5hrl" }),
      { params: Promise.resolve({ id: "post-1" }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.reportCreate).toHaveBeenCalledWith({
      data: {
        postId: null,
        commentId: "cmsejtt1g000u3y9wd3cy5hrl",
        reporterId: "reporter-1",
        reason: "HARASSMENT",
        note: null,
      },
    });
  });

  it("keeps one active report per reporter and target", async () => {
    mocks.postFindFirst.mockResolvedValue({ id: "post-1", authorId: "author-1" });
    mocks.reportFindFirst.mockResolvedValue({ id: "existing", status: "REVIEWING" });

    const response = await POST(request({ reason: "SPAM" }), {
      params: Promise.resolve({ id: "post-1" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.reportCreate).not.toHaveBeenCalled();
  });
});
