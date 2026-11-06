import { Readable } from "node:stream";

import { fail } from "@/lib/api-response";
import {
  adminFailureResponse,
  checkSession,
  isAuthenticatedSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import {
  createPrivateStorageReadStream,
  statPrivateStorageKey,
} from "@/lib/storage";

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

function timestampForFilename(date = new Date()): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];

  return parts.map((part) => String(part).padStart(2, "0")).join("");
}

function parseRangeHeader(
  rangeHeader: string | null,
  sizeBytes: number,
): { start: number; end: number } | null {
  if (!rangeHeader) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart && rawEnd) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;

    return {
      start: Math.max(sizeBytes - suffixLength, 0),
      end: sizeBytes - 1,
    };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : sizeBytes - 1;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, sizeBytes - 1),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; imageId: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id, imageId } = await context.params;

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (!isAuthenticatedSession(sessionResult)) {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", { status: 503 });
  }

  try {
    const isAdmin = !adminFailureResponse(sessionResult);
    const image = await db.generatedImage.findFirst({
      where: {
        id: imageId,
        generation: {
          id,
          deletedAt: null,
          ...(isAdmin ? {} : { userId: sessionResult.user.id }),
        },
      },
      select: {
        storageKey: true,
        thumbnailKey: true,
        mimeType: true,
      },
    });

    if (!image) {
      return fail("NOT_FOUND", "图片不存在", { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const wantsThumbnail = searchParams.get("variant") === "thumb";
    const storageKey =
      wantsThumbnail && image.thumbnailKey
        ? image.thumbnailKey
        : image.storageKey;
    const mimeType =
      wantsThumbnail && image.thumbnailKey ? "image/webp" : image.mimeType;
    const stats = await statPrivateStorageKey(storageKey);
    const sizeBytes = stats.size;
    const range = parseRangeHeader(request.headers.get("range"), sizeBytes);

    if (request.headers.get("range") && !range) {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${sizeBytes}`,
        },
      });
    }

    const stream = createPrivateStorageReadStream(
      storageKey,
      range ?? undefined,
    );
    const responseBody = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    const contentLength = range ? range.end - range.start + 1 : sizeBytes;
    const headers: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Content-Type": mimeType,
      "Content-Length": String(contentLength),
      "Content-Disposition": wantsThumbnail
        ? "inline"
        : `attachment; filename="chugao-${timestampForFilename()}.${extensionForMimeType(image.mimeType)}"`,
      "Cache-Control": wantsThumbnail
        ? "private, max-age=3600"
        : "private, max-age=300",
    };

    if (range) {
      headers["Content-Range"] =
        `bytes ${range.start}-${range.end}/${sizeBytes}`;
    }

    return new Response(responseBody, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "生成服务暂时不可用", { status: 503 });
    }

    return fail("INTERNAL_ERROR", "图片读取失败", { status: 500 });
  }
}
