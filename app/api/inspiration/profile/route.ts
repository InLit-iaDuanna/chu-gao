import { Discipline } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";

const websiteSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "网站仅支持 HTTP 或 HTTPS");

const profileSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  bio: z.string().trim().max(1_000).nullable().optional(),
  designerTitle: z.string().trim().max(60).nullable().optional(),
  designerLocation: z.string().trim().max(80).nullable().optional(),
  designerWebsite: z.union([websiteSchema, z.literal(""), z.null()]).optional(),
  designDisciplines: z.array(z.nativeEnum(Discipline)).max(8).optional(),
});

const profileSelect = {
  id: true,
  email: true,
  name: true,
  avatarKey: true,
  bio: true,
  designerTitle: true,
  designerLocation: true,
  designerWebsite: true,
  designDisciplines: true,
  createdAt: true,
} as const;

function serializeProfile<
  T extends {
    id: string;
    email: string;
    name: string | null;
    avatarKey: string | null;
    bio: string | null;
    designerTitle: string | null;
    designerLocation: string | null;
    designerWebsite: string | null;
    designDisciplines: Discipline[];
    createdAt: Date;
  },
>(user: T) {
  return {
    id: user.id,
    email: user.email,
    name: user.name?.trim() || user.email.split("@")[0],
    avatarUrl: user.avatarKey
      ? `/api/inspiration/users/${user.id}/avatar`
      : null,
    bio: user.bio,
    designerTitle: user.designerTitle,
    designerLocation: user.designerLocation,
    designerWebsite: user.designerWebsite,
    designDisciplines: user.designDisciplines,
    joinedAt: user.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const user = await db.user.findUnique({
    where: { id: sessionResult.user.id },
    select: profileSelect,
  });
  if (!user) return fail("NOT_FOUND", "用户不存在", { status: 404 });
  return ok(serializeProfile(user));
}

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = profileSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "设计师资料参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });

  const data = parsed.data;
  const user = await db.user.update({
    where: { id: sessionResult.user.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.bio !== undefined ? { bio: data.bio || null } : {}),
      ...(data.designerTitle !== undefined
        ? { designerTitle: data.designerTitle || null }
        : {}),
      ...(data.designerLocation !== undefined
        ? { designerLocation: data.designerLocation || null }
        : {}),
      ...(data.designerWebsite !== undefined
        ? { designerWebsite: data.designerWebsite || null }
        : {}),
      ...(data.designDisciplines !== undefined
        ? { designDisciplines: [...new Set(data.designDisciplines)] }
        : {}),
    },
    select: profileSelect,
  });
  return ok(serializeProfile(user));
}
