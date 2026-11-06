import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  checkSession: vi.fn(),
  dailyFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  transaction: vi.fn(),
  postUpdate: vi.fn(),
  dailyUpdate: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

vi.mock("@/lib/auth", () => ({
  checkSession: mocks.checkSession,
  adminFailureResponse: () => null,
  authenticatedUser: (result: { user: unknown }) => result.user,
}));

vi.mock("@/lib/db", () => ({
  db: {
    dailyPrompt: { findUnique: mocks.dailyFindUnique },
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { PATCH } from "@/app/api/admin/inspiration/daily/[id]/route";

const publishedAt = new Date("2026-08-01T02:00:00.000Z");
const archivedAt = new Date("2026-08-03T02:00:00.000Z");

const session = {
  status: "authenticated" as const,
  user: {
    id: "admin-1",
    email: "admin@example.com",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  },
};

function dailyPrompt(questionPostOverrides: Record<string, unknown> = {}) {
  return {
    id: "daily-1",
    status: "ARCHIVED",
    discipline: "GRAPHIC",
    title: "今日命题",
    prompt: "观察日常秩序",
    keywords: ["秩序"],
    publishedAt,
    questionPostId: "question-1",
    questionPost: {
      id: "question-1",
      status: "HIDDEN",
      deletedAt: null,
      moderationNote: null,
      hiddenAt: archivedAt,
      publishedAt,
      ...questionPostOverrides,
    },
  };
}

function patchStatus(status: "PUBLISHED" | "SCHEDULED") {
  return PATCH(
    new Request("https://chugao.test/api/admin/inspiration/daily/daily-1", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://chugao.test",
      },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: "daily-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue(session);
  mocks.userFindUnique.mockResolvedValue({
    name: "策展人",
    email: "admin@example.com",
  });
  mocks.dailyUpdate.mockImplementation(async ({ data }) => ({
    id: "daily-1",
    ...data,
  }));
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      designPost: { update: mocks.postUpdate },
      dailyPrompt: { update: mocks.dailyUpdate },
    }),
  );
});

describe("admin daily prompt restoration", () => {
  it("restores the official question when a normally archived prompt is published again", async () => {
    mocks.dailyFindUnique.mockResolvedValue(dailyPrompt());

    const response = await patchStatus("PUBLISHED");

    expect(response.status).toBe(200);
    expect(mocks.postUpdate).toHaveBeenCalledWith({
      where: { id: "question-1" },
      data: expect.objectContaining({
        status: "PUBLISHED",
        publishedAt,
        hiddenAt: null,
      }),
    });
  });

  it.each([
    ["soft-deleted", { deletedAt: new Date("2026-08-03T03:00:00.000Z") }],
    ["moderated", { moderationNote: "举报处理下架" }],
  ])(
    "does not automatically restore a %s official question",
    async (_label, overrides) => {
      mocks.dailyFindUnique.mockResolvedValue(dailyPrompt(overrides));

      const response = await patchStatus("PUBLISHED");

      expect(response.status).toBe(200);
      expect(mocks.postUpdate).toHaveBeenCalledWith({
        where: { id: "question-1" },
        data: expect.objectContaining({
          status: "HIDDEN",
          publishedAt,
          hiddenAt: archivedAt,
        }),
      });
    },
  );
});
