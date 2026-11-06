import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { canEditAuthor, wishIdentity } from "@/lib/wish-pool";

const updateSchema = z.object({
  title: z.string().trim().min(2).max(80).optional(),
  content: z.string().trim().min(2).max(2000).optional(),
  status: z.enum(["OPEN", "PLANNED", "IN_PROGRESS", "COMPLETED", "DECLINED"]).optional(),
  isPinned: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  const session = sessionResult.status === "authenticated" ? sessionResult.user : null;
  const identity = wishIdentity(request.headers, session);
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "修改内容不合法", { status: 400 });

  const existing = await db.wish.findUnique({ where: { id: (await params).id } });
  if (!existing) return fail("NOT_FOUND", "愿望不存在", { status: 404 });
  if (!canEditAuthor(existing, identity)) return fail("FORBIDDEN", "你不能修改这条愿望", { status: 403 });
  if ((parsed.data.status || parsed.data.isPinned !== undefined) && session?.role !== "ADMIN") {
    return fail("FORBIDDEN", "只有管理员可以修改处理状态", { status: 403 });
  }

  const updated = await db.wish.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  return ok({ ...updated, authorKeyHash: undefined, authorIpHash: undefined, canEdit: true });
}
