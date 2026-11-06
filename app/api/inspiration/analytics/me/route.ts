import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  creatorActivitySeries,
  dayKey,
  participationStats,
} from "@/lib/inspiration";

const ACTIVITY_DAYS = 14;

function engagement(post: {
  likeCount: number;
  bookmarkCount: number;
  commentCount: number;
  derivedCount: number;
}): number {
  return post.likeCount + post.bookmarkCount + post.commentCount + post.derivedCount;
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const userId = sessionResult.user.id;
  const activitySince = new Date(Date.now() - (ACTIVITY_DAYS + 1) * 86_400_000);
  const [posts, participation, likes, bookmarks, comments, derivations] = await Promise.all([
    db.designPost.findMany({
      where: { authorId: userId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        shape: true,
        discipline: true,
        likeCount: true,
        bookmarkCount: true,
        commentCount: true,
        derivedCount: true,
        publishedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.designPost.findMany({
      where: { authorId: userId, dailyPromptId: { not: null }, status: "PUBLISHED", deletedAt: null },
      select: { dailyPrompt: { select: { day: true } } },
      orderBy: { publishedAt: "desc" },
    }),
    db.postLike.findMany({
      where: { post: { authorId: userId, deletedAt: null }, userId: { not: userId }, createdAt: { gte: activitySince } },
      select: { createdAt: true },
    }),
    db.postBookmark.findMany({
      where: { post: { authorId: userId, deletedAt: null }, userId: { not: userId }, createdAt: { gte: activitySince } },
      select: { createdAt: true },
    }),
    db.postComment.findMany({
      where: { post: { authorId: userId, deletedAt: null }, authorId: { not: userId }, deletedAt: null, createdAt: { gte: activitySince } },
      select: { createdAt: true },
    }),
    db.designPost.findMany({
      where: {
        derivedFrom: { authorId: userId, deletedAt: null },
        authorId: { not: userId },
        status: "PUBLISHED",
        deletedAt: null,
        publishedAt: { gte: activitySince },
      },
      select: { publishedAt: true, createdAt: true },
    }),
  ]);
  const challenge = participationStats(
    participation.map((item) => item.dailyPrompt?.day.toISOString().slice(0, 10)),
  );
  const activity = creatorActivitySeries(
    [
      ...likes.map((item) => ({ kind: "likes" as const, createdAt: item.createdAt })),
      ...bookmarks.map((item) => ({ kind: "bookmarks" as const, createdAt: item.createdAt })),
      ...comments.map((item) => ({ kind: "comments" as const, createdAt: item.createdAt })),
      ...derivations.map((item) => ({ kind: "derived" as const, createdAt: item.publishedAt ?? item.createdAt })),
    ],
    ACTIVITY_DAYS,
  );
  const publishedPosts = posts.filter((post) => post.status === "PUBLISHED");
  const totals = posts.reduce(
    (total, post) => ({
      posts: total.posts + 1,
      published: total.published + (post.status === "PUBLISHED" ? 1 : 0),
      likes: total.likes + post.likeCount,
      bookmarks: total.bookmarks + post.bookmarkCount,
      comments: total.comments + post.commentCount,
      derived: total.derived + post.derivedCount,
    }),
    { posts: 0, published: 0, likes: 0, bookmarks: 0, comments: 0, derived: 0 },
  );
  const breakdown = <K extends "discipline" | "shape">(key: K) =>
    Array.from(
      publishedPosts.reduce((rows, post) => {
        const value = post[key];
        const current = rows.get(value) ?? { value, posts: 0, engagement: 0 };
        current.posts += 1;
        current.engagement += engagement(post);
        rows.set(value, current);
        return rows;
      }, new Map<string, { value: string; posts: number; engagement: number }>()),
    )
      .map(([, value]) => value)
      .sort((a, b) => b.posts - a.posts || b.engagement - a.engagement);

  return ok({
    totals: { ...totals, engagement: totals.likes + totals.bookmarks + totals.comments + totals.derived },
    averages: {
      engagementPerPublished: publishedPosts.length
        ? Number((publishedPosts.reduce((sum, post) => sum + engagement(post), 0) / publishedPosts.length).toFixed(1))
        : 0,
    },
    challenge,
    dailyPromptStreak: challenge.currentStreak,
    activity: {
      days: activity,
      total: activity.reduce((sum, item) => sum + item.total, 0),
      asOf: dayKey(),
    },
    breakdown: {
      disciplines: breakdown("discipline"),
      shapes: breakdown("shape"),
    },
    posts: [...posts]
      .map((post) => ({ ...post, engagement: engagement(post) }))
      .sort((a, b) => b.engagement - a.engagement || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)),
  });
}
