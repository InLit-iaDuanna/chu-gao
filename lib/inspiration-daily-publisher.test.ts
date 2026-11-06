import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dailyFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  transaction: vi.fn(),
  latestDailyFindUnique: vi.fn(),
  postUpdate: vi.fn(),
  postCreate: vi.fn(),
  dailyUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    dailyPrompt: { findMany: mocks.dailyFindMany },
    user: { findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/inspiration", () => ({
  dayKey: () => "2026-08-04",
  rankScoreForCounts: () => 42,
}));

import { publishDueDailyPrompts } from "@/lib/inspiration-daily";

const now = new Date("2026-08-04T03:00:00.000Z");

function scheduledPrompt(questionPostOverrides: Record<string, unknown> = {}) {
  return {
    id: "daily-1",
    day: new Date("2026-08-04T00:00:00.000Z"),
    status: "SCHEDULED",
    discipline: "GRAPHIC",
    title: "今日命题",
    prompt: "观察日常秩序",
    publishedAt: null,
    questionPostId: "question-1",
    questionPost: {
      id: "question-1",
      status: "HIDDEN",
      deletedAt: null,
      moderationNote: null,
      publishedAt: null,
      likeCount: 2,
      bookmarkCount: 1,
      commentCount: 3,
      derivedCount: 0,
      ...questionPostOverrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindFirst.mockResolvedValue({
    id: "admin-1",
    name: "策展人",
    email: "admin@example.com",
  });
  mocks.latestDailyFindUnique.mockResolvedValue({
    status: "SCHEDULED",
    questionPostId: "question-1",
  });
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      dailyPrompt: {
        findUnique: mocks.latestDailyFindUnique,
        update: mocks.dailyUpdate,
      },
      designPost: {
        update: mocks.postUpdate,
        create: mocks.postCreate,
      },
    }),
  );
});

describe("scheduled daily prompt publisher", () => {
  it("publishes the hidden official question when its scheduled day arrives", async () => {
    mocks.dailyFindMany.mockResolvedValue([scheduledPrompt()]);

    await expect(publishDueDailyPrompts(now)).resolves.toBe(1);

    expect(mocks.postUpdate).toHaveBeenCalledWith({
      where: { id: "question-1" },
      data: expect.objectContaining({
        status: "PUBLISHED",
        publishedAt: now,
        hiddenAt: null,
        rankScore: 42,
      }),
    });
    expect(mocks.postCreate).not.toHaveBeenCalled();
    expect(mocks.dailyUpdate).toHaveBeenCalledWith({
      where: { id: "daily-1" },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
        questionPostId: "question-1",
      },
    });
  });

  it.each([
    ["soft-deleted", { deletedAt: new Date("2026-08-03T03:00:00.000Z") }],
    ["moderated", { moderationNote: "举报处理下架" }],
  ])(
    "does not revive or replace a %s official question",
    async (_label, overrides) => {
      mocks.dailyFindMany.mockResolvedValue([scheduledPrompt(overrides)]);

      await expect(publishDueDailyPrompts(now)).resolves.toBe(1);

      expect(mocks.postUpdate).not.toHaveBeenCalled();
      expect(mocks.postCreate).not.toHaveBeenCalled();
      expect(mocks.dailyUpdate).toHaveBeenCalledWith({
        where: { id: "daily-1" },
        data: {
          status: "PUBLISHED",
          publishedAt: now,
          questionPostId: "question-1",
        },
      });
    },
  );
});
