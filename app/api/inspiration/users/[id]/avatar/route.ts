import { Readable } from "node:stream";

import { fail } from "@/lib/api-response";
import { db } from "@/lib/db";
import {
  createDesignerAvatarReadStream,
  createPrivateStorageReadStream,
  mimeTypeForStorageKey,
  normalizeUploadedReferenceKey,
  statDesignerAvatarStorageKey,
  statPrivateStorageKey,
} from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await db.user.findUnique({ where: { id }, select: { avatarKey: true } });
  if (!user?.avatarKey) return fail("NOT_FOUND", "头像不存在", { status: 404 });
  const uploadedKey = normalizeUploadedReferenceKey(user.avatarKey);
  const isOwnedUpload = Boolean(uploadedKey?.startsWith(`uploads/${id}/`));
  try {
    const stats = isOwnedUpload ? await statPrivateStorageKey(user.avatarKey) : await statDesignerAvatarStorageKey(user.avatarKey);
    const stream = isOwnedUpload ? createPrivateStorageReadStream(user.avatarKey) : createDesignerAvatarReadStream(user.avatarKey);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": mimeTypeForStorageKey(user.avatarKey),
        "Content-Length": String(stats.size),
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return fail("NOT_FOUND", "头像不存在", { status: 404 });
  }
}
