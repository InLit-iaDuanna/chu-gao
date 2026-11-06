import { PostStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { dayKey, rankScoreForCounts } from "@/lib/inspiration";
import { canAutomaticallyPublishDailyQuestion } from "@/lib/inspiration-admin";

/** Publish scheduled daily prompts whose Shanghai calendar day has arrived. */
export async function publishDueDailyPrompts(
  now = new Date(),
): Promise<number> {
  const today = new Date(`${dayKey(now)}T00:00:00.000Z`);
  const due = await db.dailyPrompt.findMany({
    where: { status: "SCHEDULED", day: { lte: today } },
    include: { questionPost: true },
    orderBy: { day: "asc" },
    take: 31,
  });
  if (!due.length) return 0;

  const curator = await db.user.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true, name: true, email: true },
  });
  const curatorName =
    curator?.name?.trim() || curator?.email?.split("@")[0] || "Chūgǎo 策展";

  let published = 0;
  for (const prompt of due) {
    await db.$transaction(async (tx) => {
      const latest = await tx.dailyPrompt.findUnique({
        where: { id: prompt.id },
        select: { status: true, questionPostId: true },
      });
      if (latest?.status !== "SCHEDULED") return;

      let questionPostId = latest.questionPostId;
      if (
        questionPostId &&
        canAutomaticallyPublishDailyQuestion(prompt.questionPost)
      ) {
        const publishedAt = prompt.questionPost.publishedAt ?? now;
        await tx.designPost.update({
          where: { id: questionPostId },
          data: {
            title: prompt.title,
            story: prompt.prompt,
            discipline: prompt.discipline,
            status: PostStatus.PUBLISHED,
            publishedAt,
            hiddenAt: null,
            rankScore: rankScoreForCounts({
              likes: prompt.questionPost.likeCount,
              bookmarks: prompt.questionPost.bookmarkCount,
              comments: prompt.questionPost.commentCount,
              derived: prompt.questionPost.derivedCount,
              publishedAt,
            }),
          },
        });
      } else if (!questionPostId) {
        const question = await tx.designPost.create({
          data: {
            authorId: curator?.id ?? null,
            authorNameSnapshot: curatorName,
            shape: "QUESTION",
            discipline: prompt.discipline,
            title: prompt.title,
            story: prompt.prompt,
            status: PostStatus.PUBLISHED,
            trustTier: "TRUSTED",
            publishedAt: now,
            rankScore: rankScoreForCounts({
              likes: 0,
              bookmarks: 0,
              comments: 0,
              derived: 0,
              publishedAt: now,
            }),
          },
        });
        questionPostId = question.id;
      }

      await tx.dailyPrompt.update({
        where: { id: prompt.id },
        data: {
          status: "PUBLISHED",
          publishedAt: prompt.publishedAt ?? now,
          questionPostId,
        },
      });
      published += 1;
    });
  }

  return published;
}
