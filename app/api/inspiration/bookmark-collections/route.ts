import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";

const collectionSchema = z.object({
  name: z.string().trim().min(1, "收藏夹名称不能为空").max(40),
  description: z.string().trim().max(500).nullable().optional(),
});

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const collections = await db.bookmarkCollection.findMany({
    where: { userId: sessionResult.user.id },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { items: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });

  return ok({
    items: collections.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      itemCount: item._count.items,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = collectionSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "收藏夹参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const collection = await db.bookmarkCollection.create({
      data: {
        userId: sessionResult.user.id,
        name: parsed.data.name,
        description: parsed.data.description || null,
      },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return ok({
      ...collection,
      itemCount: 0,
      createdAt: collection.createdAt.toISOString(),
      updatedAt: collection.updatedAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return fail("CONFLICT", "已经有同名收藏夹", { status: 409 });
    }
    throw error;
  }
}
