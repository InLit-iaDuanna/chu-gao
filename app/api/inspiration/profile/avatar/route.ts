import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { removeDesignerAvatar, saveDesignerAvatar } from "@/lib/storage";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const runtime = "nodejs";

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return fail("VALIDATION_ERROR", "请选择头像图片", { status: 400 });
  if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_AVATAR_BYTES) {
    return fail("VALIDATION_ERROR", "头像仅支持 5MB 内的 PNG、JPEG 或 WEBP", { status: 400 });
  }

  const current = await db.user.findUnique({ where: { id: sessionResult.user.id }, select: { avatarKey: true } });
  if (!current) return fail("NOT_FOUND", "用户不存在", { status: 404 });
  let saved;
  try {
    saved = await saveDesignerAvatar({ buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type, userId: sessionResult.user.id });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid uploaded image") return fail("VALIDATION_ERROR", "头像文件不是有效图片", { status: 400 });
    throw error;
  }
  try {
    await db.user.update({ where: { id: sessionResult.user.id }, data: { avatarKey: saved.storageKey } });
  } catch (error) {
    await removeDesignerAvatar(saved.storageKey).catch(() => undefined);
    throw error;
  }
  await removeDesignerAvatar(current.avatarKey).catch(() => undefined);
  return ok({ avatarUrl: `/api/inspiration/users/${sessionResult.user.id}/avatar?v=${Date.now()}` });
}

export async function DELETE(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const current = await db.user.findUnique({ where: { id: sessionResult.user.id }, select: { avatarKey: true } });
  if (!current) return fail("NOT_FOUND", "用户不存在", { status: 404 });
  await db.user.update({ where: { id: sessionResult.user.id }, data: { avatarKey: null } });
  await removeDesignerAvatar(current.avatarKey).catch(() => undefined);
  return ok({ avatarUrl: null });
}
