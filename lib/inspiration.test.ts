import { describe, expect, it } from "vitest";

import {
  creatorActivitySeries,
  dayKey,
  participationStats,
  postCreateSchema,
  publicRecipeSnapshot,
  rankScoreForCounts,
  serializePost,
  type PostRow,
} from "@/lib/inspiration";

describe("inspiration publishing", () => {
  it("requires media for WORK but allows a text-only QUESTION", () => {
    expect(
      postCreateSchema.safeParse({
        shape: "WORK",
        discipline: "GRAPHIC",
        title: "一张作品",
        media: [],
      }).success,
    ).toBe(false);

    expect(
      postCreateSchema.safeParse({
        shape: "QUESTION",
        discipline: "SERVICE",
        title: "等待应该怎样被设计？",
        media: [],
      }).success,
    ).toBe(true);
  });

  it("defaults a regular composer submission to the standard source", () => {
    const parsed = postCreateSchema.parse({
      shape: "QUESTION",
      discipline: "SERVICE",
      title: "来源类型默认值",
      media: [],
    });

    expect(parsed.sourceType).toBe("STANDARD");
  });

  it("requires a source explanation for REFERENCE", () => {
    expect(
      postCreateSchema.safeParse({
        shape: "REFERENCE",
        discipline: "BRAND",
        title: "一个值得看的品牌",
      }).success,
    ).toBe(false);
  });

  it("keeps REFERENCE posts text-and-link only", () => {
    expect(
      postCreateSchema.safeParse({
        shape: "REFERENCE",
        discipline: "BRAND",
        title: "一个值得看的品牌",
        externalUrl: "https://example.com/reference",
        sourceNote: "它对品牌层级的处理值得讨论。",
        media: [
          {
            sourceKey: "uploads/user-1/reference.png",
            mimeType: "image/png",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("serializes only the public recipe allowlist", () => {
    expect(
      publicRecipeSnapshot({
        prompt: "minimal poster",
        aspectRatio: "4:5",
        resolution: "2K",
        providerId: "secret-provider",
        providerAccountId: "secret-account",
        costCredits: 99,
        pricingSnapshot: { internal: true },
      }),
    ).toEqual({
      prompt: "minimal poster",
      aspectRatio: "4:5",
      resolution: "2K",
    });
  });

  it("hides both positive and negative prompts for structure-only recipes", () => {
    const now = new Date("2026-08-04T00:00:00.000Z");
    const post = serializePost({
      id: "post-1",
      authorId: "designer-1",
      authorNameSnapshot: "林一",
      author: { id: "designer-1", name: "林一", email: "author@example.com" },
      shape: "WORK",
      discipline: "GRAPHIC",
      title: "结构公开测试",
      story: null,
      origin: "ORIGINAL",
      sourceType: "NODES",
      externalUrl: null,
      sourceNote: null,
      promptVisibility: "STRUCTURE_ONLY",
      status: "PUBLISHED",
      trustTier: "TRUSTED",
      hasMedia: true,
      likeCount: 0,
      bookmarkCount: 0,
      commentCount: 0,
      derivedCount: 0,
      rankScore: 0,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      media: [
        {
          id: "media-1",
          deletedAt: null,
          order: 0,
          width: 1024,
          height: 1024,
          mimeType: "image/png",
          role: "FINAL",
          isCover: true,
          recipe: {
            prompt: "PRIVATE_POSITIVE_PROMPT",
            negativePrompt: "PRIVATE_NEGATIVE_PROMPT",
            aspectRatio: "1:1",
            modelName: "Public model",
          },
        },
      ],
      tags: [],
      dailyPrompt: null,
    } as unknown as PostRow);

    expect(post.media[0]?.recipe).toEqual({
      aspectRatio: "1:1",
      modelName: "Public model",
    });
    expect(post).not.toHaveProperty("trustTier");
    expect(post).not.toHaveProperty("rankScore");
    expect(post.sourceTypeLabel).toBe("节点工作流");
    expect(JSON.stringify(post)).not.toContain("PRIVATE_POSITIVE_PROMPT");
    expect(JSON.stringify(post)).not.toContain("PRIVATE_NEGATIVE_PROMPT");
  });

  it("weights a derivation above lightweight reactions", () => {
    const base = {
      likes: 0,
      bookmarks: 0,
      comments: 0,
      derived: 0,
      publishedAt: null,
    };
    expect(rankScoreForCounts({ ...base, derived: 1 })).toBeGreaterThan(
      rankScoreForCounts({ ...base, bookmarks: 2 }),
    );
  });

  it("uses the Shanghai calendar day", () => {
    expect(dayKey(new Date("2026-08-03T16:30:00.000Z"))).toBe("2026-08-04");
  });

  it("does not report an expired participation run as the current streak", () => {
    expect(
      participationStats(
        ["2026-07-28", "2026-07-29", "2026-07-30"],
        "2026-08-04",
      ),
    ).toEqual({
      currentStreak: 0,
      bestStreak: 3,
      totalDays: 3,
      lastParticipationDay: "2026-07-30",
      participatedToday: false,
    });
  });

  it("keeps a daily challenge streak alive through yesterday", () => {
    expect(
      participationStats(
        ["2026-08-01", "2026-08-02", "2026-08-03"],
        "2026-08-04",
      ),
    ).toMatchObject({
      currentStreak: 3,
      bestStreak: 3,
      participatedToday: false,
    });
  });

  it("groups creator reactions by the Shanghai day", () => {
    expect(
      creatorActivitySeries(
        [
          { kind: "likes", createdAt: new Date("2026-08-03T16:30:00.000Z") },
          { kind: "comments", createdAt: new Date("2026-08-04T03:00:00.000Z") },
        ],
        2,
        "2026-08-04",
      ),
    ).toEqual([
      {
        day: "2026-08-03",
        likes: 0,
        bookmarks: 0,
        comments: 0,
        derived: 0,
        total: 0,
      },
      {
        day: "2026-08-04",
        likes: 1,
        bookmarks: 0,
        comments: 1,
        derived: 0,
        total: 2,
      },
    ]);
  });
});
