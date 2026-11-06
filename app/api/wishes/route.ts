import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import {
  attachWishAuthorCookie,
  consumeWishQuota,
  publicAuthorName,
  remainingWishQuota,
  wishIdentity,
} from "@/lib/wish-pool";

const createSchema = z.object({
  title: z.string().trim().min(2).max(80),
  content: z.string().trim().min(2).max(2000),
  authorName: z.string().trim().max(24).optional(),
});

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const session = sessionResult.status === "authenticated" ? sessionResult.user : null;
  const identity = wishIdentity(request.headers, session);
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 80);
  const status = url.searchParams.get("status");
  const take = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 50);
  const cursor = url.searchParams.get("cursor");
  const validStatuses = ["OPEN", "PLANNED", "IN_PROGRESS", "COMPLETED", "DECLINED"] as const;
  const selectedStatus = validStatuses.find((item) => item === status);

  try {
    const rows = await db.wish.findMany({
      where: {
        ...(selectedStatus ? { status: selectedStatus } : {}),
        ...(query
          ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { content: { contains: query, mode: "insensitive" } }] }
          : {}),
      },
      include: { comments: { orderBy: { createdAt: "asc" } } },
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = rows.slice(0, take).map((wish) => ({
      ...wish,
      authorKeyHash: undefined,
      authorIpHash: undefined,
      canEdit: identity.session?.role === "ADMIN" ||
        (wish.userId ? wish.userId === identity.session?.id : wish.authorKeyHash === identity.tokenHash),
      comments: wish.comments.map((comment) => ({
        ...comment,
        authorKeyHash: undefined,
        authorIpHash: undefined,
        canEdit: identity.session?.role === "ADMIN" ||
          (comment.userId ? comment.userId === identity.session?.id : comment.authorKeyHash === identity.tokenHash),
      })),
    }));
    return attachWishAuthorCookie(ok({
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      remainingToday: await remainingWishQuota(identity.ipHash),
      viewer: session ? { role: session.role, email: session.email } : null,
    }), identity);
  } catch {
    return fail("SERVICE_UNAVAILABLE", "许愿池暂时不可用", { status: 503 });
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const session = sessionResult.status === "authenticated" ? sessionResult.user : null;
  const identity = wishIdentity(request.headers, session);
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "请完整填写愿望标题和内容", { status: 400 });

  try {
    if (session?.role !== "ADMIN" && !(await consumeWishQuota(identity.ipHash))) {
      return fail("DAILY_LIMIT_REACHED", "今天已经发布 3 条，明天再来吧", { status: 429 });
    }
    const wish = await db.wish.create({
      data: {
        title: parsed.data.title,
        content: parsed.data.content,
        authorName: publicAuthorName(parsed.data.authorName, session),
        authorIpHash: identity.ipHash,
        authorKeyHash: session ? null : identity.tokenHash,
        userId: session?.id,
      },
    });
    return attachWishAuthorCookie(ok({ ...wish, authorKeyHash: undefined, authorIpHash: undefined, canEdit: true }, { status: 201 }), identity);
  } catch {
    return fail("SERVICE_UNAVAILABLE", "愿望发布失败，请稍后重试", { status: 503 });
  }
}
