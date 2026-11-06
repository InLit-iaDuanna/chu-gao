// PPT 导出为 ZIP：按关联 Generation 的图片打包。

import { ZipArchive } from "archiver";
import { NextResponse } from "next/server";

import { checkSession } from "@/lib/auth";
import { fail } from "@/lib/api-response";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  createPrivateStorageReadStream,
  extensionForMimeType,
} from "@/lib/storage";

// archiver 依赖 Node 内置流/Buffer，必须跑在 Node runtime（而非 edge）。
export const runtime = "nodejs";

function positiveNumberEnv(name: string, fallback: number): number {
  const configured = Number(process.env[name]);

  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function maxExportSlides(): number {
  return positiveNumberEnv("PPT_EXPORT_MAX_SLIDES", 120);
}

function maxExportBytes(): number {
  return positiveNumberEnv("PPT_EXPORT_MAX_MB", 300) * 1024 * 1024;
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  try {
    const session = sessionResult.user;
    const { searchParams } = new URL(request.url);
    const pptId = searchParams.get("id");

    if (!pptId) {
      return fail("VALIDATION_ERROR", "缺少 PPT ID", { status: 400 });
    }

    const record = await db.pPTGeneration.findFirst({
      where: { id: pptId, userId: session.id },
      include: {
        slides: {
          orderBy: { index: "asc" },
          include: { generation: { include: { images: true } } },
        },
      },
    });

    if (!record) {
      return fail("NOT_FOUND", "PPT 记录不存在", { status: 404 });
    }

    const exportableImages = record.slides
      .map((slide) => {
        const generation = slide.generation;

        if (!generation || generation.status !== "SUCCEEDED") {
          return null;
        }

        const image = [...generation.images].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )[0];

        if (!image) {
          return null;
        }

        return {
          extension: extensionForMimeType(image.mimeType),
          sizeBytes: image.sizeBytes,
          storageKey: image.storageKey,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (exportableImages.length === 0) {
      return fail("VALIDATION_ERROR", "没有可导出的幻灯片", { status: 400 });
    }

    if (exportableImages.length > maxExportSlides()) {
      return fail("EXPORT_TOO_LARGE", "可导出的幻灯片过多", { status: 413 });
    }

    const totalBytes = exportableImages.reduce(
      (total, entry) => total + entry.sizeBytes,
      0,
    );

    if (totalBytes > maxExportBytes()) {
      return fail("EXPORT_TOO_LARGE", "导出图片总大小过大", { status: 413 });
    }

    const entries = exportableImages.map((entry, index) => ({
      ...entry,
      name: `${String(index + 1).padStart(3, "0")}.${entry.extension}`,
    }));

    const archive = new ZipArchive({
      zlib: { level: 9 },
    });

    const stream = new ReadableStream({
      start(controller) {
        archive.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        archive.on("end", () => controller.close());
        archive.on("error", (err: Error) => controller.error(err));
        archive.on("warning", (err: Error) => controller.error(err));

        for (const entry of entries) {
          const source = createPrivateStorageReadStream(entry.storageKey);

          source.on("error", (error) => archive.emit("error", error));
          archive.append(source, { name: entry.name });
        }
        Promise.resolve(archive.finalize()).catch((error: Error) =>
          controller.error(error),
        );
      },
      cancel() {
        archive.abort();
      },
    });

    const filename =
      (record.title ?? record.theme ?? "presentation")
        .replace(/[^a-zA-Z0-9]/g, "_")
        .slice(0, 80) || "presentation";

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}_PPT.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logger.error({ error }, "PPT export failed.");
    return fail("INTERNAL_ERROR", "导出失败", { status: 500 });
  }
}
