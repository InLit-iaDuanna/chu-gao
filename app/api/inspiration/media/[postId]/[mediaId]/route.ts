import { Readable } from "node:stream";

import { fail } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { createDesignPostReadStream, statDesignPostStorageKey } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ postId: string; mediaId: string }> },
) {
  const { postId, mediaId } = await params;
  const sessionResult = await checkSession(request);
  const viewer = sessionResult.status === "authenticated" ? sessionResult.user : null;
  const media = await db.designPostMedia.findFirst({
    where: { id: mediaId, postId, deletedAt: null },
    include: { post: { select: { authorId: true, status: true, deletedAt: true } } },
  });
  if (!media || media.post.deletedAt) return fail("NOT_FOUND", "图片不存在", { status: 404 });
  const canPreview = viewer && (viewer.id === media.post.authorId || viewer.role === "ADMIN");
  if (media.post.status !== "PUBLISHED" && !canPreview) return fail("NOT_FOUND", "图片不存在", { status: 404 });
  const cacheControl =
    media.post.status === "PUBLISHED"
      ? "public, max-age=300, s-maxage=300, stale-while-revalidate=60"
      : "private, no-store";

  const key = new URL(request.url).searchParams.get("variant") === "thumb" && media.thumbnailKey
    ? media.thumbnailKey
    : media.storageKey;
  try {
    const stats = await statDesignPostStorageKey(key);
    const stream = createDesignPostReadStream(key);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": key.endsWith(".webp") ? "image/webp" : media.mimeType,
        "Content-Length": String(stats.size),
        "Cache-Control": cacheControl,
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return fail("NOT_FOUND", "图片不存在", { status: 404 });
  }
}
