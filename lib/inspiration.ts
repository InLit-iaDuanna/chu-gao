import {
  Discipline,
  FollowTargetType,
  MediaRole,
  PostOrigin,
  PostShape,
  PostSourceType,
  PromptVisibility,
  Prisma,
  TagKind,
  TrustTier,
} from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";

export const postInclude = {
  media: true,
  tags: { include: { tag: true } },
  author: { select: { id: true, name: true, email: true } },
  dailyPrompt: true,
  _count: {
    select: { comments: true, likes: true, bookmarks: true, derivations: true },
  },
} satisfies Prisma.DesignPostInclude;

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  GRAPHIC: "视觉平面",
  PRODUCT: "产品体验",
  INDUSTRIAL: "工业硬件",
  SERVICE: "服务流程",
  SPATIAL: "空间环境",
  BRAND: "品牌策略",
  MOTION: "动态影像",
  DATAVIZ: "信息可视化",
};

export const SHAPE_LABELS: Record<PostShape, string> = {
  WORK: "作品",
  TEARDOWN: "拆解",
  PATTERN: "模式",
  QUESTION: "命题",
  REFERENCE: "参考",
  PROCESS: "过程",
};

export const ORIGIN_LABELS: Record<PostOrigin, string> = {
  ORIGINAL: "原创",
  STUDY: "研究/临摹",
  REPOST: "转载",
};

export const SOURCE_TYPE_LABELS: Record<PostSourceType, string> = {
  STANDARD: "常规发布",
  CANVAS: "Canvas",
  NODES: "节点工作流",
  PPT: "PPT",
};

export const PROMPT_VISIBILITY_LABELS: Record<PromptVisibility, string> = {
  PUBLIC: "完全公开",
  STRUCTURE_ONLY: "只公开结构",
  PRIVATE: "完全私有",
};

const mediaSchema = z.object({
  sourceKey: z.string().trim().min(1).max(500).optional(),
  sourceGeneratedImageId: z.string().cuid().optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
  role: z.nativeEnum(MediaRole).default(MediaRole.FINAL),
  isCover: z.boolean().default(false),
  recipe: z.record(z.string(), z.unknown()).optional(),
});

export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "链接仅支持 HTTP 或 HTTPS");

export const postCreateSchema = z
  .object({
    shape: z.nativeEnum(PostShape),
    discipline: z.nativeEnum(Discipline),
    title: z.string().trim().max(120),
    story: z.string().trim().max(10_000).optional().nullable(),
    origin: z.nativeEnum(PostOrigin).default(PostOrigin.ORIGINAL),
    sourceType: z.nativeEnum(PostSourceType).default(PostSourceType.STANDARD),
    externalUrl: httpUrlSchema.optional().nullable(),
    sourceNote: z.string().trim().max(3_000).optional().nullable(),
    promptVisibility: z
      .nativeEnum(PromptVisibility)
      .default(PromptVisibility.STRUCTURE_ONLY),
    tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
    media: z.array(mediaSchema).max(9).default([]),
    dailyPromptId: z.string().cuid().optional().nullable(),
    derivedFromPostId: z.string().cuid().optional().nullable(),
    draft: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.draft && value.title.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "请填写至少 2 个字符的标题",
      });
    }
    if (!value.draft && value.shape === PostShape.WORK && value.media.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["media"],
        message: "作品必须包含图片",
      });
    }
    if (!value.draft && value.shape === PostShape.PROCESS && value.media.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["media"],
        message: "过程帖子至少需要两张图",
      });
    }
    if (
      !value.draft &&
      value.shape === PostShape.REFERENCE &&
      (!value.externalUrl || !value.sourceNote)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceNote"],
        message: "参考帖子需要同时填写外链和来源说明",
      });
    }
    if (value.shape === PostShape.REFERENCE && value.media.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["media"],
        message: "参考帖子只保存外链与手写说明，不附带站内图片",
      });
    }
    if (
      value.origin === PostOrigin.REPOST &&
      !value.externalUrl &&
      !value.sourceNote
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceNote"],
        message: "转载内容需要填写来源",
      });
    }
  });

export const commentSchema = z.object({
  content: z.string().trim().min(1).max(2_000),
  parentId: z.string().cuid().optional().nullable(),
});

export const followSchema = z.object({
  targetType: z.nativeEnum(FollowTargetType),
  targetKey: z.string().trim().min(1).max(120),
  following: z.boolean().optional(),
});

export type PostCreateInput = z.infer<typeof postCreateSchema>;

export type PostRow = Prisma.DesignPostGetPayload<{
  include: typeof postInclude;
}>;

export type CommentTreeRow = Prisma.PostCommentGetPayload<Record<string, never>> & {
  replies?: CommentTreeRow[];
};

export interface SerializedInspirationComment {
  id: string;
  postId: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  content: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  replies: SerializedInspirationComment[];
}

export function mediaApiUrl(
  postId: string,
  mediaId: string,
  thumbnail = false,
): string {
  const query = thumbnail ? "?variant=thumb" : "";
  return `/api/inspiration/media/${encodeURIComponent(postId)}/${encodeURIComponent(mediaId)}${query}`;
}

function recipeForVisibility(
  value: unknown,
  visibility: PromptVisibility,
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    visibility === PromptVisibility.PRIVATE
  )
    return null;
  const input = value as Record<string, unknown>;
  const allowed = [
    "prompt",
    "negativePrompt",
    "aspectRatio",
    "resolution",
    "seed",
    "modelName",
    "styleTags",
  ];
  const output: Record<string, unknown> = {};
  for (const key of allowed) {
    const candidate = input[key];
    if (candidate !== undefined && candidate !== null && candidate !== "")
      output[key] = candidate;
  }
  if (visibility === PromptVisibility.STRUCTURE_ONLY) {
    delete output.prompt;
    delete output.negativePrompt;
  }
  return Object.keys(output).length ? output : null;
}

export function serializePost(row: PostRow, viewer?: { id: string } | null) {
  return {
    id: row.id,
    author: {
      id: row.authorId,
      name: row.authorNameSnapshot,
      email:
        viewer?.id && row.author?.id === viewer.id
          ? (row.author?.email ?? null)
          : null,
    },
    shape: row.shape,
    shapeLabel: SHAPE_LABELS[row.shape],
    discipline: row.discipline,
    disciplineLabel: DISCIPLINE_LABELS[row.discipline],
    title: row.title,
    story: row.story,
    origin: row.origin,
    originLabel: ORIGIN_LABELS[row.origin],
    sourceType: row.sourceType,
    sourceTypeLabel: SOURCE_TYPE_LABELS[row.sourceType],
    externalUrl: row.externalUrl,
    sourceNote: row.sourceNote,
    promptVisibility: row.promptVisibility,
    status: row.status,
    hasMedia: row.hasMedia,
    counts: {
      likes: row.likeCount,
      bookmarks: row.bookmarkCount,
      comments: row.commentCount,
      derived: row.derivedCount,
    },
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    media: row.media
      .filter((media) => !media.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map((media) => ({
        id: media.id,
        url: mediaApiUrl(row.id, media.id),
        thumbnailUrl: mediaApiUrl(row.id, media.id, true),
        width: media.width,
        height: media.height,
        mimeType: media.mimeType,
        order: media.order,
        role: media.role,
        isCover: media.isCover,
        recipe: recipeForVisibility(media.recipe, row.promptVisibility),
      })),
    tags: row.tags.map(({ tag }) => ({
      id: tag.id,
      slug: tag.slug,
      name: tag.name,
      kind: tag.kind,
    })),
    dailyPrompt: row.dailyPrompt?.status === "PUBLISHED"
      ? {
          id: row.dailyPrompt.id,
          day: row.dailyPrompt.day.toISOString().slice(0, 10),
          title: row.dailyPrompt.title,
          prompt: row.dailyPrompt.prompt,
          keywords: row.dailyPrompt.keywords,
        }
      : null,
    viewer: {
      isAuthor: Boolean(viewer?.id && row.authorId === viewer.id),
      isLiked: false,
      isBookmarked: false,
    },
  };
}

/**
 * Serialize a batch of posts while resolving the viewer's interaction state
 * in one pair of queries.  A number of secondary feeds (daily prompt,
 * designer profile, bookmarks and the personal post list) used to call
 * serializePost directly, which left their buttons stuck at false.
 */
export async function serializePostsForViewer(
  rows: PostRow[],
  viewer?: { id: string } | null,
) {
  if (!rows.length || !viewer) return rows.map((row) => serializePost(row, viewer));

  const postIds = rows.map((row) => row.id);
  const [likes, bookmarks] = await Promise.all([
    db.postLike.findMany({
      where: { userId: viewer.id, postId: { in: postIds } },
      select: { postId: true },
    }),
    db.postBookmark.findMany({
      where: { userId: viewer.id, postId: { in: postIds } },
      select: { postId: true },
    }),
  ]);
  const liked = new Set(likes.map((item) => item.postId));
  const bookmarked = new Set(bookmarks.map((item) => item.postId));

  return rows.map((row) => {
    const serialized = serializePost(row, viewer);
    return {
      ...serialized,
      viewer: {
        ...serialized.viewer,
        isLiked: liked.has(row.id),
        isBookmarked: bookmarked.has(row.id),
      },
    };
  });
}

export function publicRecipeSnapshot(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of [
    "prompt",
    "negativePrompt",
    "aspectRatio",
    "resolution",
    "seed",
    "modelName",
    "styleTags",
  ]) {
    const item = input[key];
    if (item !== undefined && item !== null && item !== "") output[key] = item;
  }
  return Object.keys(output).length ? output : null;
}

export function dayKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDayKey(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface ParticipationStats {
  currentStreak: number;
  bestStreak: number;
  totalDays: number;
  lastParticipationDay: string | null;
  participatedToday: boolean;
}

/**
 * Computes challenge participation from calendar-day keys instead of elapsed
 * milliseconds. A current streak remains active when the latest response is
 * today or yesterday, but an older historical run is not reported as current.
 */
export function participationStats(
  values: Array<string | null | undefined>,
  today = dayKey(),
): ParticipationStats {
  const days = Array.from(
    new Set(
      values.filter((value): value is string =>
        Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)),
      ),
    ),
  ).sort();
  const daySet = new Set(days);

  let bestStreak = 0;
  let running = 0;
  let previous: string | null = null;
  for (const value of days) {
    running = previous && shiftDayKey(previous, 1) === value ? running + 1 : 1;
    bestStreak = Math.max(bestStreak, running);
    previous = value;
  }

  const participatedToday = daySet.has(today);
  let expected = participatedToday ? today : shiftDayKey(today, -1);
  let currentStreak = 0;
  while (daySet.has(expected)) {
    currentStreak += 1;
    expected = shiftDayKey(expected, -1);
  }

  return {
    currentStreak,
    bestStreak,
    totalDays: days.length,
    lastParticipationDay: days.at(-1) ?? null,
    participatedToday,
  };
}

export type CreatorActivityKind =
  | "likes"
  | "bookmarks"
  | "comments"
  | "derived";

export interface CreatorActivityDay {
  day: string;
  likes: number;
  bookmarks: number;
  comments: number;
  derived: number;
  total: number;
}

export function creatorActivitySeries(
  events: Array<{ kind: CreatorActivityKind; createdAt: Date }>,
  numberOfDays = 14,
  today = dayKey(),
): CreatorActivityDay[] {
  const length = Math.min(Math.max(Math.trunc(numberOfDays) || 14, 1), 90);
  const rows = Array.from({ length }, (_, index) => {
    const day = shiftDayKey(today, index - length + 1);
    return { day, likes: 0, bookmarks: 0, comments: 0, derived: 0, total: 0 };
  });
  const rowByDay = new Map(rows.map((row) => [row.day, row]));
  for (const event of events) {
    const row = rowByDay.get(dayKey(event.createdAt));
    if (!row) continue;
    row[event.kind] += 1;
    row.total += 1;
  }
  return rows;
}

export async function consumePostQuota(
  ipHash: string,
  limit = 3,
): Promise<boolean> {
  const day = dayKey();
  const current = await db.postDailyQuota.upsert({
    where: { ipHash_day: { ipHash, day } },
    create: { ipHash, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (current.count <= limit) return true;
  await db.postDailyQuota.update({
    where: { ipHash_day: { ipHash, day } },
    data: { count: { decrement: 1 } },
  });
  return false;
}

export async function getTrustTier(userId: string): Promise<TrustTier> {
  const [generations, reports, restrictedMarker, trustedMarker] =
    await Promise.all([
      db.generation.count({
        where: { userId, status: "SUCCEEDED", deletedAt: null },
      }),
      db.contentReport.count({
        where: {
          status: "RESOLVED",
          OR: [
            {
              post: {
                authorId: userId,
                status: "HIDDEN",
              },
            },
            {
              comment: {
                authorId: userId,
                deletedAt: { not: null },
              },
            },
          ],
        },
      }),
      db.designPost.count({
        where: { authorId: userId, trustTier: TrustTier.RESTRICTED },
      }),
      db.designPost.count({
        where: {
          authorId: userId,
          trustTier: TrustTier.TRUSTED,
          status: { in: ["PUBLISHED", "HIDDEN"] },
        },
      }),
    ]);
  if (restrictedMarker > 0 || reports >= 3) return TrustTier.RESTRICTED;
  return generations > 0 || trustedMarker > 0
    ? TrustTier.TRUSTED
    : TrustTier.NEW;
}

export function rankScoreForCounts(input: {
  likes: number;
  bookmarks: number;
  comments: number;
  derived: number;
  publishedAt?: Date | null;
}): number {
  const ageHours = input.publishedAt
    ? Math.max(0, (Date.now() - input.publishedAt.getTime()) / 3_600_000)
    : 0;
  const recency = Math.max(0, 24 - ageHours / 6);
  return Number(
    (
      recency +
      input.likes +
      input.bookmarks * 2 +
      input.comments * 3 +
      input.derived * 5
    ).toFixed(4),
  );
}

export function tagSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}_-]/gu, "")
    .slice(0, 48);
}

export async function ensureTags(
  tags: string[],
  kind: TagKind = TagKind.STYLE,
) {
  const unique = Array.from(new Set(tags.map(tagSlug).filter(Boolean))).slice(
    0,
    12,
  );
  const rows = [];
  for (const slug of unique) {
    rows.push(
      await db.designTag.upsert({
        where: { slug },
        create: { slug, name: slug.replace(/-/g, " "), kind },
        update: {},
      }),
    );
  }
  return rows;
}

/** Keep the denormalized counter aligned with visible public posts only. */
export async function syncTagUsageCounts(tagIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(tagIds.filter(Boolean)));
  await Promise.all(
    uniqueIds.map(async (tagId) => {
      const usageCount = await db.postTag.count({
        where: {
          tagId,
          post: { status: "PUBLISHED", deletedAt: null },
        },
      });
      await db.designTag.update({
        where: { id: tagId },
        data: { usageCount },
      });
    }),
  );
}

export function serializeComment(
  row: CommentTreeRow,
): SerializedInspirationComment {
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId,
    authorId: row.deletedAt ? null : row.authorId,
    authorName: row.deletedAt ? "已删除评论" : row.authorNameSnapshot,
    content: row.deletedAt ? "该评论已删除" : row.content,
    deleted: Boolean(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    replies: (row.replies ?? []).map((reply) => serializeComment(reply)),
  };
}

export const mediaRoleLabel: Record<MediaRole, string> = {
  FINAL: "成品",
  PROCESS: "过程",
};
