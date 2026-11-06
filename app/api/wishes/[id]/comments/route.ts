import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { attachWishAuthorCookie, publicAuthorName, wishIdentity } from "@/lib/wish-pool";

const schema = z.object({
  content: z.string().trim().min(1).max(1000),
  authorName: z.string().trim().max(24).optional(),
  parentId: z.string().cuid().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  const session = sessionResult.status === "authenticated" ? sessionResult.user : null;
  const identity = wishIdentity(request.headers, session);
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "回复内容不合法", { status: 400 });
  const wishId = (await params).id;

  try {
    const wish = await db.wish.findUnique({ where: { id: wishId }, select: { id: true } });
    if (!wish) return fail("NOT_FOUND", "愿望不存在", { status: 404 });
    if (parsed.data.parentId) {
      const parent = await db.wishComment.findFirst({ where: { id: parsed.data.parentId, wishId }, select: { id: true } });
      if (!parent) return fail("VALIDATION_ERROR", "要回复的内容不存在", { status: 400 });
    }
    const comment = await db.wishComment.create({
      data: {
        wishId,
        parentId: parsed.data.parentId,
        content: parsed.data.content,
        authorName: publicAuthorName(parsed.data.authorName, session),
        authorIpHash: identity.ipHash,
        authorKeyHash: session ? null : identity.tokenHash,
        userId: session?.id,
        isAdmin: session?.role === "ADMIN",
      },
    });
    return attachWishAuthorCookie(ok({ ...comment, authorKeyHash: undefined, authorIpHash: undefined, canEdit: true }, { status: 201 }), identity);
  } catch {
    return fail("SERVICE_UNAVAILABLE", "回复失败，请稍后重试", { status: 503 });
  }
}
