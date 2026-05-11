import { fail, ok } from "@/lib/api-response";
import { authenticatedUser, checkSession } from "@/lib/auth";
import { saveUploadedReferenceImage } from "@/lib/storage";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function maxUploadBytes(): number {
  return Number(process.env.MAX_UPLOAD_SIZE_MB ?? 10) * 1024 * 1024;
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return fail("VALIDATION_ERROR", "请选择一张参考图", { status: 400 });
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return fail("VALIDATION_ERROR", "参考图仅支持 PNG、JPEG 或 WEBP", {
      status: 400,
    });
  }

  if (file.size <= 0 || file.size > maxUploadBytes()) {
    return fail(
      "VALIDATION_ERROR",
      `参考图大小不能超过 ${process.env.MAX_UPLOAD_SIZE_MB ?? 10}MB`,
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await saveUploadedReferenceImage({
    buffer,
    mimeType: file.type,
    userId: authenticatedUser(sessionResult).id,
  });

  return ok({
    key: saved.storageKey,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    width: saved.width,
    height: saved.height,
  });
}
