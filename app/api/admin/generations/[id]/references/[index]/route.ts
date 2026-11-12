import sharp from "sharp";
import { fail } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readPrivateStorageKey } from "@/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const failure = adminFailureResponse(await checkSession(request));
  if (failure) return failure;
  const { id, index } = await params;
  if (!/^\d{1,2}$/.test(index))
    return fail("NOT_FOUND", "参考图不存在", { status: 404 });
  try {
    const generation = await db.generation.findUnique({
      where: { id },
      select: { referenceImageKeys: true },
    });
    const key = generation?.referenceImageKeys[Number(index)];
    if (!key) return fail("NOT_FOUND", "参考图不存在", { status: 404 });
    const image = await sharp(await readPrivateStorageKey(key), {
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({
        width: 640,
        height: 640,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer();
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return fail("NOT_FOUND", "参考图已过期或不可读取", { status: 404 });
  }
}
