import { Discipline, PostStatus, Prisma, TrustTier } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { authenticatedUser, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  consumePostQuota,
  dayKey,
  DISCIPLINE_LABELS,
  ensureTags,
  getTrustTier,
  postCreateSchema,
  postInclude,
  publicRecipeSnapshot,
  rankScoreForCounts,
  serializePost,
  SHAPE_LABELS,
  syncTagUsageCounts,
  type PostRow,
} from "@/lib/inspiration";
import { isInspirationTextBlocked } from "@/lib/inspiration-moderation";
import { getModel } from "@/lib/models/registry";
import { ModerationRejectionLimitError } from "@/lib/rate-limit";
import { readJsonBodySafe } from "@/lib/request-body";
import {
  copyStorageToDesignPostSnapshot,
  removeDesignPostSnapshots,
} from "@/lib/storage";
import { wishIdentity } from "@/lib/wish-pool";

export const runtime = "nodejs";

function parseTake(value: string | null): number {
  if (value === null || value.trim() === "") return 24;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "灵感圈暂时不可用", { status: 503 });
  }

  const url = new URL(request.url);
  const sessionResult = await checkSession(request);
  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }
  const viewer =
    sessionResult.status === "authenticated" ? sessionResult.user : null;
  const discipline = url.searchParams.get("discipline");
  const shape = url.searchParams.get("shape");
  const tab = url.searchParams.get("tab") ?? "recommended";
  const query = url.searchParams.get("q")?.trim().slice(0, 120);
  const tag = url.searchParams.get("tag")?.trim().slice(0, 48);
  const cursor = url.searchParams.get("cursor");
  const take = parseTake(url.searchParams.get("limit"));

  const validDiscipline = Object.hasOwn(DISCIPLINE_LABELS, discipline ?? "")
    ? (discipline as keyof typeof DISCIPLINE_LABELS)
    : undefined;
  const validShape = Object.hasOwn(SHAPE_LABELS, shape ?? "")
    ? (shape as keyof typeof SHAPE_LABELS)
    : undefined;

  const where: Prisma.DesignPostWhereInput = {
    status: PostStatus.PUBLISHED,
    deletedAt: null,
    ...(validDiscipline ? { discipline: validDiscipline } : {}),
    ...(validShape ? { shape: validShape } : {}),
    ...(tag ? { tags: { some: { tag: { slug: tag } } } } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { story: { contains: query, mode: "insensitive" } },
            { sourceNote: { contains: query, mode: "insensitive" } },
            {
              tags: {
                some: {
                  tag: { name: { contains: query, mode: "insensitive" } },
                },
              },
            },
          ],
        }
      : {}),
  };

  try {
    if (tab === "following") {
      if (!viewer)
        return fail("UNAUTHORIZED", "请先登录查看关注动态", { status: 401 });
      const follows = await db.userFollow.findMany({
        where: { followerId: viewer.id },
      });
      const userIds = follows
        .filter((item) => item.targetType === "USER")
        .map((item) => item.targetKey);
      const disciplines = follows.flatMap((item) =>
        item.targetType === "DISCIPLINE" &&
        Object.hasOwn(DISCIPLINE_LABELS, item.targetKey)
          ? [item.targetKey as Discipline]
          : [],
      );
      const tagIds = follows
        .filter((item) => item.targetType === "TAG")
        .map((item) => item.targetKey);
      where.AND = [
        {
          OR: [
            ...(userIds.length
              ? [
                  {
                    authorId: { in: userIds },
                  } as Prisma.DesignPostWhereInput,
                ]
              : []),
            ...(disciplines.length
              ? [
                  {
                    discipline: { in: disciplines },
                  } as Prisma.DesignPostWhereInput,
                ]
              : []),
            ...(tagIds.length
              ? [
                  {
                    tags: {
                      some: { tagId: { in: tagIds } },
                    },
                  } as Prisma.DesignPostWhereInput,
                ]
              : []),
          ],
        },
      ];
    }

    const usesDynamicRanking = tab === "recommended" || tab === "hot";
    const scoreById = new Map<string, number>();
    let pageRows: PostRow[];
    let nextCursor: string | null = null;

    if (usesDynamicRanking) {
      const candidates = await db.designPost.findMany({
        where,
        include: postInclude,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: 240,
      });
      const candidateIds = candidates.map((item) => item.id);
      const [rankLikes, rankBookmarks, follows] = await Promise.all([
        candidateIds.length
          ? db.postLike.groupBy({
              by: ["postId"],
              where: { postId: { in: candidateIds }, countsForRank: true },
              _count: { _all: true },
            })
          : [],
        candidateIds.length
          ? db.postBookmark.groupBy({
              by: ["postId"],
              where: { postId: { in: candidateIds }, countsForRank: true },
              _count: { _all: true },
            })
          : [],
        tab === "recommended" && viewer
          ? db.userFollow.findMany({ where: { followerId: viewer.id } })
          : [],
      ]);
      const likesByPost = new Map(
        rankLikes.map((item) => [item.postId, item._count._all]),
      );
      const bookmarksByPost = new Map(
        rankBookmarks.map((item) => [item.postId, item._count._all]),
      );
      const followedUsers = new Set(
        follows
          .filter((item) => item.targetType === "USER")
          .map((item) => item.targetKey),
      );
      const followedDisciplines = new Set(
        follows.flatMap((item) =>
          item.targetType === "DISCIPLINE" &&
          Object.hasOwn(DISCIPLINE_LABELS, item.targetKey)
            ? [item.targetKey as Discipline]
            : [],
        ),
      );
      const followedTags = new Set(
        follows
          .filter((item) => item.targetType === "TAG")
          .map((item) => item.targetKey),
      );
      const boost = (post: (typeof candidates)[number]) =>
        tab === "recommended"
          ? (post.authorId && followedUsers.has(post.authorId) ? 8 : 0) +
            (followedDisciplines.has(post.discipline) ? 5 : 0) +
            post.tags.reduce(
              (score, item) => score + (followedTags.has(item.tagId) ? 3 : 0),
              0,
            )
          : 0;
      for (const post of candidates) {
        scoreById.set(
          post.id,
          rankScoreForCounts({
            likes: likesByPost.get(post.id) ?? 0,
            bookmarks: bookmarksByPost.get(post.id) ?? 0,
            comments: post.commentCount,
            derived: post.derivedCount,
            publishedAt: post.publishedAt,
          }),
        );
      }
      const sorted = [...candidates].sort((a, b) => {
        const scoreDifference =
          (scoreById.get(b.id) ?? 0) +
          boost(b) -
          ((scoreById.get(a.id) ?? 0) + boost(a));
        if (scoreDifference) return scoreDifference;
        const dateDifference =
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
        return dateDifference || b.id.localeCompare(a.id);
      });
      const cursorIndex = cursor
        ? sorted.findIndex((item) => item.id === cursor)
        : -1;
      if (cursor && cursorIndex === -1) {
        // Dynamic rankings can move or evict a post between page requests.
        // Treat a stale/unknown cursor as the end of this pagination window;
        // falling back to index 0 would resend the first page indefinitely.
        pageRows = [];
      } else {
        const startIndex = cursorIndex + 1;
        pageRows = sorted.slice(startIndex, startIndex + take);
        nextCursor =
          startIndex + take < sorted.length
            ? (pageRows.at(-1)?.id ?? null)
            : null;
      }
    } else {
      const rows = await db.designPost.findMany({
        where,
        include: postInclude,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      pageRows = rows.slice(0, take);
      nextCursor = rows.length > take ? (pageRows.at(-1)?.id ?? null) : null;
    }
    const postIds = pageRows.map((item) => item.id);
    const [likes, bookmarks] = viewer
      ? await Promise.all([
          db.postLike.findMany({
            where: { userId: viewer.id, postId: { in: postIds } },
            select: { postId: true },
          }),
          db.postBookmark.findMany({
            where: { userId: viewer.id, postId: { in: postIds } },
            select: { postId: true },
          }),
        ])
      : [[], []];
    const liked = new Set(likes.map((item) => item.postId));
    const bookmarked = new Set(bookmarks.map((item) => item.postId));

    return ok({
      items: pageRows.map((row) => {
        const serialized = serializePost(row, viewer);
        return {
          ...serialized,
          viewer: {
            ...serialized.viewer,
            isLiked: liked.has(row.id),
            isBookmarked: bookmarked.has(row.id),
          },
        };
      }),
      nextCursor,
      filters: {
        disciplines: Object.entries(DISCIPLINE_LABELS).map(
          ([value, label]) => ({ value, label }),
        ),
        shapes: Object.entries(SHAPE_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
      },
    });
  } catch (error) {
    return fail("INTERNAL_ERROR", "灵感列表读取失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (sessionResult.status === "unauthenticated")
    return fail("UNAUTHORIZED", "请先登录后发布", { status: 401 });
  const user = authenticatedUser(sessionResult);

  const rateLimitFailure = await userActionRateLimitResponse(
    user.id,
    "inspiration-post",
    process.env.RATE_LIMIT_INSPIRATION_POST_PER_MIN,
    6,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = postCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "发布内容不完整", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const moderationText = [
    parsed.data.title,
    parsed.data.story,
    parsed.data.sourceNote,
    ...parsed.data.tags,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    if (
      await isInspirationTextBlocked({
        request,
        user,
        text: moderationText,
        surface: "POST_CREATE",
      })
    ) {
      return fail("CONTENT_BLOCKED", "内容包含不适合公开发布的信息", {
        status: 400,
      });
    }
  } catch (error) {
    if (error instanceof ModerationRejectionLimitError) {
      return fail("RATE_LIMITED", error.message, { status: 429 });
    }
    throw error;
  }

  const identity = wishIdentity(request.headers, user);
  const trustTier = await getTrustTier(user.id);
  const dailyLimit = trustTier === TrustTier.TRUSTED ? 10 : 3;
  if (
    user.role !== "ADMIN" &&
    !(await consumePostQuota(identity.ipHash, dailyLimit))
  ) {
    return fail("DAILY_LIMIT_REACHED", `今天最多发布 ${dailyLimit} 条内容`, {
      status: 429,
    });
  }

  const profile = await db.user.findUnique({
    where: { id: user.id },
    select: { name: true, email: true },
  });
  const authorName =
    profile?.name?.trim() || profile?.email?.split("@")[0] || "设计师";
  const finalStatus = parsed.data.draft
    ? PostStatus.DRAFT
    : user.role === "ADMIN" || trustTier === TrustTier.TRUSTED
      ? PostStatus.PUBLISHED
      : PostStatus.PENDING;

  const dailyPrompt = parsed.data.dailyPromptId
    ? await db.dailyPrompt.findFirst({
        where: {
          id: parsed.data.dailyPromptId,
          status: "PUBLISHED",
          day: { lte: new Date(`${dayKey()}T00:00:00.000Z`) },
        },
        select: { id: true, discipline: true },
      })
    : null;
  if (
    parsed.data.dailyPromptId &&
    (!dailyPrompt || dailyPrompt.discipline !== parsed.data.discipline)
  ) {
    return fail("VALIDATION_ERROR", "每日命题不存在、尚未发布或学科不匹配", {
      status: 400,
    });
  }

  const derivedParent = parsed.data.derivedFromPostId
    ? await db.designPost.findFirst({
        where: {
          id: parsed.data.derivedFromPostId,
          status: PostStatus.PUBLISHED,
          deletedAt: null,
        },
        select: { id: true },
      })
    : null;
  if (parsed.data.derivedFromPostId && !derivedParent) {
    return fail("VALIDATION_ERROR", "只能从公开且未删除的帖子继续创作", {
      status: 400,
    });
  }

  const savedSnapshots: Array<{
    storageKey: string;
    thumbnailKey?: string | null;
  }> = [];
  let postId: string | null = null;
  let affectedTagIds: string[] = [];

  try {
    const post = await db.designPost.create({
      data: {
        authorId: user.id,
        authorNameSnapshot: authorName,
        shape: parsed.data.shape,
        discipline: parsed.data.discipline,
        title: parsed.data.title,
        story: parsed.data.story || null,
        origin: parsed.data.origin,
        sourceType: parsed.data.sourceType,
        externalUrl: parsed.data.externalUrl || null,
        sourceNote: parsed.data.sourceNote || null,
        promptVisibility: parsed.data.promptVisibility,
        status: PostStatus.DRAFT,
        trustTier,
        derivedFromPostId: parsed.data.derivedFromPostId || null,
        dailyPromptId: dailyPrompt?.id ?? null,
      },
    });
    postId = post.id;

    const tagRows = await ensureTags(parsed.data.tags);
    affectedTagIds = tagRows.map((tag) => tag.id);
    if (tagRows.length) {
      await db.postTag.createMany({
        data: tagRows.map((tag) => ({ postId: post.id, tagId: tag.id })),
        skipDuplicates: true,
      });
    }

    for (const [index, media] of parsed.data.media.entries()) {
      let sourceKey: string;
      let mimeType: string;
      let sourceGeneratedImageId: string | null = null;
      let recipe: Record<string, unknown> | null = publicRecipeSnapshot(
        media.recipe,
      );

      if (media.sourceGeneratedImageId) {
        const generatedImage = await db.generatedImage.findFirst({
          where: {
            id: media.sourceGeneratedImageId,
            generation: { userId: user.id, deletedAt: null },
          },
          include: { generation: true },
        });
        if (!generatedImage)
          throw new Error("selected generated image not found");
        sourceKey = generatedImage.storageKey;
        mimeType = generatedImage.mimeType;
        sourceGeneratedImageId = generatedImage.id;
        recipe = publicRecipeSnapshot({
          prompt: generatedImage.generation.prompt,
          negativePrompt: generatedImage.generation.negativePrompt,
          aspectRatio: generatedImage.generation.aspectRatio,
          resolution: generatedImage.generation.resolution,
          seed: generatedImage.generation.seed?.toString() ?? null,
          modelName:
            getModel(generatedImage.generation.modelId)?.displayName ??
            generatedImage.generation.modelId,
        });
      } else if (media.sourceKey?.startsWith(`uploads/${user.id}/`)) {
        sourceKey = media.sourceKey;
        mimeType = media.mimeType ?? "image/png";
      } else {
        throw new Error("invalid media source");
      }

      const snapshot = await copyStorageToDesignPostSnapshot({
        postId: post.id,
        index,
        sourceKey,
        mimeType,
      });
      savedSnapshots.push(snapshot);
      await db.designPostMedia.create({
        data: {
          postId: post.id,
          ...snapshot,
          order: index,
          role: media.role,
          isCover:
            media.isCover ||
            (index === 0 && !parsed.data.media.some((item) => item.isCover)),
          sourceGeneratedImageId,
          recipe: recipe ? (recipe as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
    }

    const publishedAt =
      finalStatus === PostStatus.PUBLISHED ? new Date() : null;
    const updated = await db.designPost.update({
      where: { id: post.id },
      data: {
        hasMedia: parsed.data.media.length > 0,
        status: finalStatus,
        publishedAt,
        rankScore: publishedAt
          ? rankScoreForCounts({
              likes: 0,
              bookmarks: 0,
              comments: 0,
              derived: 0,
              publishedAt,
            })
          : 0,
      },
      include: postInclude,
    });

    if (parsed.data.derivedFromPostId && finalStatus === PostStatus.PUBLISHED) {
      const parent = await db.designPost.findUnique({
        where: { id: parsed.data.derivedFromPostId },
        select: {
          id: true,
          derivedCount: true,
          likeCount: true,
          bookmarkCount: true,
          commentCount: true,
          publishedAt: true,
        },
      });
      if (parent) {
        await db.designPost.update({
          where: { id: parent.id },
          data: {
            derivedCount: { increment: 1 },
            rankScore: rankScoreForCounts({
              likes: parent.likeCount,
              bookmarks: parent.bookmarkCount,
              comments: parent.commentCount,
              derived: parent.derivedCount + 1,
              publishedAt: parent.publishedAt,
            }),
          },
        });
      }
    }

    await syncTagUsageCounts(affectedTagIds);

    return ok(serializePost(updated, user), { status: 201 });
  } catch (error) {
    if (postId)
      await db.designPost
        .delete({ where: { id: postId } })
        .catch(() => undefined);
    if (affectedTagIds.length) {
      await syncTagUsageCounts(affectedTagIds).catch(() => undefined);
    }
    await removeDesignPostSnapshots(savedSnapshots).catch(() => undefined);
    return fail("INTERNAL_ERROR", "发布失败，请稍后重试", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}
