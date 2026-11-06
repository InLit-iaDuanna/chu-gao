import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { postInclude, serializePostsForViewer } from "@/lib/inspiration";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const userId = sessionResult.user.id;
  const collectionId = new URL(request.url).searchParams.get("collectionId");
  if (collectionId) {
    const owned = await db.bookmarkCollection.findFirst({ where: { id: collectionId, userId }, select: { id: true } });
    if (!owned) return fail("NOT_FOUND", "收藏夹不存在", { status: 404 });
  }

  const [rows, collections] = await Promise.all([
    db.postBookmark.findMany({
      where: {
        userId,
        post: {
          status: "PUBLISHED",
          deletedAt: null,
          ...(collectionId ? { bookmarkCollectionItems: { some: { collectionId } } } : {}),
        },
      },
      include: { post: { include: postInclude } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.bookmarkCollection.findMany({
      where: { userId },
      select: { id: true, name: true, description: true, updatedAt: true, _count: { select: { items: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const postIds = rows.map((item) => item.postId);
  const memberships = postIds.length
    ? await db.bookmarkCollectionItem.findMany({
        where: { postId: { in: postIds }, collection: { userId } },
        select: { postId: true, collectionId: true },
      })
    : [];
  const collectionIdsByPost = new Map<string, string[]>();
  for (const membership of memberships) {
    collectionIdsByPost.set(membership.postId, [...(collectionIdsByPost.get(membership.postId) ?? []), membership.collectionId]);
  }
  const serializedPosts = await serializePostsForViewer(
    rows.map((item) => item.post),
    sessionResult.user,
  );
  const serializedById = new Map(serializedPosts.map((item) => [item.id, item]));
  return ok({
    items: rows.map((item) => ({
      ...(serializedById.get(item.postId) ?? {
        id: item.postId,
        viewer: { isAuthor: item.post.authorId === userId, isLiked: false, isBookmarked: true },
      }),
      collectionIds: collectionIdsByPost.get(item.postId) ?? [],
    })),
    collections: collections.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      itemCount: item._count.items,
      updatedAt: item.updatedAt.toISOString(),
    })),
  });
}
