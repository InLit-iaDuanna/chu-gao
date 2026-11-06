import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { canEditAuthor, wishIdentity } from "@/lib/wish-pool";

const schema = z.object({ content: z.string().trim().min(1).max(1000) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  const session = sessionResult.status === "authenticated" ? sessionResult.user : null;
  const identity = wishIdentity(request.headers, session);
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "回复内容不合法", { status: 400 });

  const existing = await db.wishComment.findUnique({ where: { id: (await params).id } });
  if (!existing) return fail("NOT_FOUND", "回复不存在", { status: 404 });
  if (!canEditAuthor(existing, identity)) return fail("FORBIDDEN", "你不能修改这条回复", { status: 403 });
  return ok({ ...(await db.wishComment.update({ where: { id: existing.id }, data: parsed.data })), authorKeyHash: undefined, authorIpHash: undefined, canEdit: true });
}
