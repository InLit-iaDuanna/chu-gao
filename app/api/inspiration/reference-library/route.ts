import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const userId = sessionResult.user.id;
  const bookmarks = await db.postBookmark.findMany({
    where: { userId, post: { status: "PUBLISHED", deletedAt: null, hasMedia: true } },
    select: {
      createdAt: true,
      post: {
        select: {
          id: true,
          title: true,
          media: {
            where: { deletedAt: null },
            select: { id: true, width: true, height: true, mimeType: true, order: true, isCover: true },
            orderBy: [{ isCover: "desc" }, { order: "asc" }],
          },
          bookmarkCollectionItems: {
            where: { collection: { userId } },
            select: { collectionId: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  return ok({
    items: bookmarks.flatMap((bookmark) =>
      bookmark.post.media.map((media) => ({
        id: media.id,
        postId: bookmark.post.id,
        postTitle: bookmark.post.title,
        previewUrl: `/api/inspiration/media/${bookmark.post.id}/${media.id}?variant=thumb`,
        width: media.width,
        height: media.height,
        mimeType: media.mimeType,
        isCover: media.isCover,
        collectionIds: bookmark.post.bookmarkCollectionItems.map((item) => item.collectionId),
        bookmarkedAt: bookmark.createdAt.toISOString(),
      })),
    ),
  });
}
