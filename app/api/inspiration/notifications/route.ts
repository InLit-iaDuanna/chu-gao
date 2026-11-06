import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { applyNotificationReadState } from "@/lib/inspiration-notifications";
import { readJsonBodySafe } from "@/lib/request-body";

const readSchema = z
  .object({
    notificationIds: z.array(z.string().min(1).max(200)).max(100).optional(),
    all: z.boolean().optional(),
  })
  .refine((value) => value.all || Boolean(value.notificationIds?.length), "请选择要标记的动态");

type NotificationItem = {
  id: string;
  type: "COMMENT" | "LIKE" | "DERIVED";
  createdAt: string;
  actorName: string;
  text: string;
  href: string;
};

async function notificationItemsForUser(userId: string): Promise<NotificationItem[]> {
  const [comments, likes, derivations] = await Promise.all([
    db.postComment.findMany({
      where: { post: { authorId: userId, status: "PUBLISHED", deletedAt: null }, authorId: { not: userId }, deletedAt: null },
      include: { post: { select: { id: true, title: true } }, author: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.postLike.findMany({
      where: { post: { authorId: userId, status: "PUBLISHED", deletedAt: null }, userId: { not: userId } },
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
  return [
    ...comments.map((item) => ({
      id: `comment:${item.id}`,
      type: "COMMENT" as const,
      createdAt: item.createdAt.toISOString(),
      actorName: item.author?.name?.trim() || item.author?.email?.split("@")[0] || item.authorNameSnapshot,
      text: `回应了《${item.post.title}》`,
      href: `/inspiration/${item.post.id}#discussion`,
    })),
    ...likes.map((item) => ({
      id: `like:${item.postId}:${item.userId}:${item.createdAt.getTime()}`,
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
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const userId = sessionResult.user.id;
  const items = await notificationItemsForUser(userId);
  const reads = items.length
    ? await db.inspirationNotificationRead.findMany({
        where: { userId, notificationKey: { in: items.map((item) => item.id) } },
        select: { notificationKey: true, readAt: true },
      })
    : [];
  return ok(applyNotificationReadState(items, reads));
}

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = readSchema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "标记动态参数不合法", { status: 400, details: parsed.error.flatten() });

  const visibleItems = await notificationItemsForUser(sessionResult.user.id);
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  const ids = parsed.data.all
    ? [...visibleIds]
    : [...new Set(parsed.data.notificationIds ?? [])].filter((id) => visibleIds.has(id));
  if (!ids.length) return ok({ marked: 0 });
  const created = await db.inspirationNotificationRead.createMany({
    data: ids.map((notificationKey) => ({ userId: sessionResult.user.id, notificationKey })),
    skipDuplicates: true,
  });
  return ok({ marked: created.count, notificationIds: ids });
}
