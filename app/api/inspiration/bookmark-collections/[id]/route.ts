import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

async function ownedCollection(id: string, userId: string) {
  return db.bookmarkCollection.findFirst({ where: { id, userId } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const { id } = await params;
  if (!(await ownedCollection(id, sessionResult.user.id))) return fail("NOT_FOUND", "收藏夹不存在", { status: 404 });

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success || (!parsed.data.name && parsed.data.description === undefined)) {
    return fail("VALIDATION_ERROR", "没有可更新的收藏夹字段", { status: 400 });
  }

  try {
    const collection = await db.bookmarkCollection.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
      },
      select: { id: true, name: true, description: true, createdAt: true, updatedAt: true, _count: { select: { items: true } } },
    });
    return ok({ ...collection, itemCount: collection._count.items, createdAt: collection.createdAt.toISOString(), updatedAt: collection.updatedAt.toISOString() });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) return fail("CONFLICT", "已经有同名收藏夹", { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const { id } = await params;
  const removed = await db.bookmarkCollection.deleteMany({ where: { id, userId: sessionResult.user.id } });
  if (!removed.count) return fail("NOT_FOUND", "收藏夹不存在", { status: 404 });
  return ok({ deleted: true });
}
