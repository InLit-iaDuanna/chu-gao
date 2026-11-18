import { Readable } from "node:stream";

import { fail, ok } from "@/lib/api-response";
import { authenticatedUser, checkSession } from "@/lib/auth";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import {
  UnsupportedImageFormatError,
  createPrivateStorageReadStream,
  normalizeUploadedReferenceKey,
  saveUploadedReferenceImage,
  sniffImageFormat,
  statPrivateStorageKey,
} from "@/lib/storage";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MULTIPART_OVERHEAD_BYTES = 512 * 1024;

export const runtime = "nodejs";

function mimeTypeForKey(key: string): string {
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".webp")) return "image/webp";
  return "image/png";
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }
  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const user = authenticatedUser(sessionResult);
  const key = normalizeUploadedReferenceKey(
    new URL(request.url).searchParams.get("key") ?? "",
  );
  if (!key || !key.startsWith("uploads/" + user.id + "/")) {
    return fail("NOT_FOUND", "图片不存在", { status: 404 });
  }

  try {
    const stats = await statPrivateStorageKey(key);
    const stream = createPrivateStorageReadStream(key);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": mimeTypeForKey(key),
        "Content-Length": String(stats.size),
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return fail("NOT_FOUND", "图片不存在", { status: 404 });
  }
}

function maxUploadBytes(): number {
  return Number(process.env.MAX_UPLOAD_SIZE_MB ?? 10) * 1024 * 1024;
}

function maxUploadBodyBytes(): number {
  const configured = Number(process.env.MAX_UPLOAD_BODY_MB);

  if (Number.isFinite(configured) && configured > 0) {
    return configured * 1024 * 1024;
  }

  return maxUploadBytes() + MULTIPART_OVERHEAD_BYTES;
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const user = authenticatedUser(sessionResult);
  const rateLimitFailure = await userActionRateLimitResponse(
    user.id,
    "upload",
    process.env.RATE_LIMIT_UPLOAD_PER_MIN,
    20,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxUploadBodyBytes()) {
    return fail("PAYLOAD_TOO_LARGE", "上传请求过大", { status: 413 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return fail("VALIDATION_ERROR", "请选择一张参考图", { status: 400 });
  }

  if (file.size <= 0 || file.size > maxUploadBytes()) {
    return fail(
      "VALIDATION_ERROR",
      `参考图大小不能超过 ${process.env.MAX_UPLOAD_SIZE_MB ?? 10}MB`,
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // The declared type is a hint only: phone pickers send "" or the wrong type
  // for otherwise perfect photos, so the bytes decide what the file is.
  const sniffed = sniffImageFormat(buffer);
  const mimeType = ALLOWED_IMAGE_TYPES.has(file.type)
    ? file.type
    : sniffed === "png" || sniffed === "jpeg" || sniffed === "webp"
      ? `image/${sniffed}`
      : file.type;

  let saved;

  try {
    saved = await saveUploadedReferenceImage({
      buffer,
      mimeType,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof UnsupportedImageFormatError) {
      const hint =
        error.detected === "heic" || error.detected === "heif"
          ? "这是 iPhone 的 HEIC 原图，请在相机设置里选择「兼容性最佳」，或在相册里先转成 JPEG 再上传。"
          : error.detected === "gif" || error.detected === "tiff"
            ? "请把图片另存为 PNG、JPEG 或 WEBP 再上传。"
            : "参考图仅支持 PNG、JPEG 或 WEBP。";
      return fail("VALIDATION_ERROR", hint, { status: 400 });
    }
    if (error instanceof Error && error.message === "invalid uploaded image") {
      return fail("VALIDATION_ERROR", "图片文件已损坏，请重新选择", { status: 400 });
    }

    throw error;
  }

  return ok({
    key: saved.storageKey,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    width: saved.width,
    height: saved.height,
  });
}
