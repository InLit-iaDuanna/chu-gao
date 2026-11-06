import { DailyPromptStatus } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayKey, postInclude, serializePostsForViewer } from "@/lib/inspiration";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedDay = url.searchParams.get("day") ?? dayKey();
  const date = new Date(`${requestedDay}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()))
    return fail("VALIDATION_ERROR", "日期不合法", { status: 400 });
  const sessionResult = await checkSession(request);
  const viewer =
    sessionResult.status === "authenticated" ? sessionResult.user : null;

  const row = await db.dailyPrompt.findFirst({
    where: { day: { lte: date }, status: DailyPromptStatus.PUBLISHED },
    include: {
      questionPost: { include: postInclude },
      features: {
        where: { post: { status: "PUBLISHED", deletedAt: null } },
        include: { post: { include: postInclude } },
        orderBy: { order: "asc" },
      },
      responses: {
        where: { status: "PUBLISHED", deletedAt: null },
        include: postInclude,
        orderBy: [{ rankScore: "desc" }, { publishedAt: "desc" }],
        take: 24,
      },
    },
    orderBy: { day: "desc" },
  });
  if (!row) return ok({ prompt: null, fallback: true });

  const disciplineFollow = viewer
    ? await db.userFollow.findUnique({
        where: {
          followerId_targetType_targetKey: {
            followerId: viewer.id,
            targetType: "DISCIPLINE",
            targetKey: row.discipline,
          },
        },
        select: { id: true },
      })
    : null;

  const questionPosts = row.questionPost ? [row.questionPost] : [];
  const featurePosts = row.features
    .filter((item) => item.post.status === "PUBLISHED" && !item.post.deletedAt)
    .map((item) => item.post);
  const responsePosts = row.responses;
  const serialized = await serializePostsForViewer(
    [...questionPosts, ...featurePosts, ...responsePosts],
    viewer,
  );
  const serializedById = new Map(serialized.map((item) => [item.id, item]));

  return ok({
    prompt: {
      id: row.id,
      day: row.day.toISOString().slice(0, 10),
      discipline: row.discipline,
      title: row.title,
      prompt: row.prompt,
      keywords: row.keywords,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      questionPost:
        row.questionPost?.status === "PUBLISHED" && !row.questionPost.deletedAt
          ? serializedById.get(row.questionPost.id) ?? null
          : null,
      features: row.features
        .filter(
          (item) => item.post.status === "PUBLISHED" && !item.post.deletedAt,
        )
        .map((item) => serializedById.get(item.post.id))
        .filter((item): item is (typeof serialized)[number] => Boolean(item)),
      responses: row.responses
        .map((item) => serializedById.get(item.id))
        .filter((item): item is (typeof serialized)[number] => Boolean(item)),
      viewer: { isFollowingDiscipline: Boolean(disciplineFollow) },
    },
  });
}
