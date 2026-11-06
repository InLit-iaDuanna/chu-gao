import { PostStatus, Prisma, TrustTier } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getTrustTier,
  publicRecipeSnapshot,
  rankScoreForCounts,
} from "@/lib/inspiration";
import { getModel } from "@/lib/models/registry";
import { readJsonBodySafe } from "@/lib/request-body";
import {
  copyStorageToDesignPostSnapshot,
  removeDesignPostSnapshots,
} from "@/lib/storage";

export const runtime = "nodejs";

const mediaSchema = z.object({
  sourceKey: z.string().trim().min(1).max(500).optional(),
  sourceGeneratedImageId: z.string().cuid().optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
  role: z.enum(["FINAL", "PROCESS"]).default("FINAL"),
  isCover: z.boolean().default(false),
  recipe: z.record(z.string(), z.unknown()).optional(),
});

const schema = z.object({ media: z.array(mediaSchema).min(1).max(9) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const rateLimit = await userActionRateLimitResponse(
    sessionResult.user.id,
    "inspiration-post-media",
    undefined,
    20,
  );
  if (rateLimit) return rateLimit;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "图片参数不合法", { status: 400 });

  const { id: postId } = await params;
  const post = await db.designPost.findUnique({
    where: { id: postId },
    include: {
      media: { where: { deletedAt: null }, orderBy: { order: "asc" } },
    },
  });
  if (!post || post.deletedAt)
    return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  if (post.authorId !== sessionResult.user.id)
    return fail("FORBIDDEN", "你不能修改这条帖子", { status: 403 });
  if (post.status === "HIDDEN")
    return fail("INVALID_STATE", "已隐藏帖子不能添加图片", { status: 409 });
  if (post.shape === "REFERENCE")
    return fail("INVALID_STATE", "参考帖子只保存外链和手写说明", {
      status: 409,
    });
  const existingGeneratedImageIds = new Set(
    post.media.flatMap((item) =>
      item.sourceGeneratedImageId ? [item.sourceGeneratedImageId] : [],
    ),
  );
  const seenSources = new Set<string>();
  const mediaToAdd = parsed.data.media.filter((media) => {
    const source = media.sourceGeneratedImageId
      ? `generated:${media.sourceGeneratedImageId}`
      : `upload:${media.sourceKey ?? ""}`;
    if (
      (media.sourceGeneratedImageId &&
        existingGeneratedImageIds.has(media.sourceGeneratedImageId)) ||
      seenSources.has(source)
    ) {
      return false;
    }
    seenSources.add(source);
    return true;
  });
  if (!mediaToAdd.length) {
    return ok({ added: 0, total: post.media.length });
  }
  if (post.media.length + mediaToAdd.length > 9)
    return fail("VALIDATION_ERROR", "每条帖子最多 9 张图片", { status: 400 });

  const currentTrustTier =
    post.status === PostStatus.PUBLISHED && sessionResult.user.role !== "ADMIN"
      ? await getTrustTier(sessionResult.user.id)
      : null;
  const requiresReview = currentTrustTier === TrustTier.RESTRICTED;
  const requestedCoverIndex = mediaToAdd.findIndex((media) => media.isCover);

  const saved: Array<{ storageKey: string; thumbnailKey?: string | null }> = [];
  try {
    const created: Prisma.DesignPostMediaUncheckedCreateInput[] = [];
    for (const [offset, media] of mediaToAdd.entries()) {
      let sourceKey: string;
      let mimeType: string;
      let sourceGeneratedImageId: string | null = null;
      let recipe = publicRecipeSnapshot(media.recipe);

      if (media.sourceGeneratedImageId) {
        const generatedImage = await db.generatedImage.findFirst({
          where: {
            id: media.sourceGeneratedImageId,
            generation: {
              userId: sessionResult.user.id,
              deletedAt: null,
            },
          },
          include: { generation: true },
        });
        if (!generatedImage) {
          await removeDesignPostSnapshots(saved).catch(() => undefined);
          return fail("NOT_FOUND", "选择的生成图片不存在或已过期", {
            status: 404,
          });
        }
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
      } else if (
        media.sourceKey?.startsWith(`uploads/${sessionResult.user.id}/`)
      ) {
        sourceKey = media.sourceKey;
        mimeType = media.mimeType ?? "image/png";
      } else {
        await removeDesignPostSnapshots(saved).catch(() => undefined);
        return fail("VALIDATION_ERROR", "图片来源不合法", { status: 400 });
      }

      const index = post.media.length + offset;
      const snapshot = await copyStorageToDesignPostSnapshot({
        postId,
        index,
        sourceKey,
        mimeType,
      });
      saved.push(snapshot);
      created.push({
        postId,
        ...snapshot,
        order: index,
        role: media.role,
        isCover:
          offset === requestedCoverIndex ||
          (requestedCoverIndex === -1 &&
            !post.media.some((item) => item.isCover) &&
            offset === 0),
        sourceGeneratedImageId,
        recipe: recipe ? (recipe as Prisma.InputJsonValue) : Prisma.JsonNull,
      });
    }

    await db.$transaction(async (tx) => {
      if (requestedCoverIndex !== -1) {
        await tx.designPostMedia.updateMany({
          where: { postId, deletedAt: null, isCover: true },
          data: { isCover: false },
        });
      }
      for (const data of created) await tx.designPostMedia.create({ data });
      await tx.designPost.update({
        where: { id: postId },
        data: {
          hasMedia: true,
          ...(requiresReview
            ? {
                status: PostStatus.PENDING,
                trustTier: TrustTier.RESTRICTED,
                rankScore: 0,
              }
            : {}),
        },
      });
      if (requiresReview && post.derivedFromPostId) {
        const parent = await tx.designPost.findUnique({
          where: { id: post.derivedFromPostId },
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
          const derived = Math.max(0, parent.derivedCount - 1);
          await tx.designPost.update({
            where: { id: parent.id },
            data: {
              derivedCount: derived,
              rankScore: rankScoreForCounts({
                likes: parent.likeCount,
                bookmarks: parent.bookmarkCount,
                comments: parent.commentCount,
                derived,
                publishedAt: parent.publishedAt,
              }),
            },
          });
        }
      }
    });
    return ok({
      added: created.length,
      total: post.media.length + created.length,
    });
  } catch (error) {
    await removeDesignPostSnapshots(saved).catch(() => undefined);
    return fail("INTERNAL_ERROR", "图片保存失败，请稍后重试", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}
