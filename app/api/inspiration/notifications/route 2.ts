import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const userId = sessionResult.user.id;
  const [comments, likes, derivations] = await Promise.all([
    db.postComment.findMany({
      where: { post: { authorId: userId }, authorId: { not: userId }, deletedAt: null },
      include: { post: { select: { id: true, title: true } }, author: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.postLike.findMany({
      where: { post: { authorId: userId }, userId: { not: userId } },
      include: { post: { select: { id: true, title: true } }, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.designPost.findMany({
      where: { derivedFrom: { authorId: userId }, authorId: { not: userId }, status: "PUBLISHED", deletedAt: null },
      select: { id: true, title: true, authorNameSnapshot: true, createdAt: true, derivedFrom: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  const items = [
    ...comments.map((item) => ({
      id: `comment:${item.id}`,
      type: "COMMENT" as const,
      createdAt: item.createdAt.toISOString(),
      actorName: item.author?.name?.trim() || item.author?.email?.split("@")[0] || item.authorNameSnapshot,
      text: `回应了《${item.post.title}》`,
      href: `/inspiration/${item.post.id}#discussion`,
    })),
    ...likes.map((item) => ({
      id: `like:${item.postId}:${item.userId}`,
      type: "LIKE" as const,
      createdAt: item.createdAt.toISOString(),
      actorName: item.user.name?.trim() || item.user.email.split("@")[0],
      text: `赞了《${item.post.title}》`,
      href: `/inspiration/${item.post.id}`,
    })),
    ...derivations.map((item) => ({
      id: `derived:${item.id}`,
      type: "DERIVED" as const,
      createdAt: item.createdAt.toISOString(),
      actorName: item.authorNameSnapshot,
      text: `接着《${item.derivedFrom?.title ?? "你的想法"}》继续创作`,
      href: `/inspiration/${item.id}`,
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 60);
  return ok({ items });
}
