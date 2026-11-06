import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { copyDesignPostSnapshotToUploadedReference } from "@/lib/storage";

const requestSchema = z.object({
  mediaIds: z.array(z.string().min(1)).min(1).max(16),
});

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const rateLimit = await userActionRateLimitResponse(
    sessionResult.user.id,
    "inspiration-bookmark-reference",
    undefined,
    30,
  );
  if (rateLimit) return rateLimit;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "请选择 1–16 张收藏图片", { status: 400, details: parsed.error.flatten() });

  const uniqueIds = [...new Set(parsed.data.mediaIds)];
  const media = await db.designPostMedia.findMany({
    where: {
      id: { in: uniqueIds },
      deletedAt: null,
      post: {
        status: "PUBLISHED",
        deletedAt: null,
        bookmarks: { some: { userId: sessionResult.user.id } },
      },
    },
    select: { id: true, storageKey: true, mimeType: true, postId: true },
  });
  if (media.length !== uniqueIds.length) return fail("NOT_FOUND", "部分图片不在你的收藏中或已下架", { status: 404 });
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const references = [];
  for (const mediaId of uniqueIds) {
    const item = mediaById.get(mediaId);
    if (!item) continue;
    const saved = await copyDesignPostSnapshotToUploadedReference({
      sourceKey: item.storageKey,
      mimeType: item.mimeType,
      userId: sessionResult.user.id,
      stableId: item.id,
    });
    references.push({
      mediaId: item.id,
      postId: item.postId,
      key: saved.storageKey,
      previewUrl: `/api/upload?key=${encodeURIComponent(saved.storageKey)}`,
      mimeType: saved.mimeType,
      width: saved.width,
      height: saved.height,
    });
  }
  return ok({ references });
}
