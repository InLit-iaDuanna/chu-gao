import { db } from "@/lib/db";
import { researchAdmin, researchFailure } from "@/lib/research/http";
import { readResearchFile } from "@/lib/research/storage";
import { ResearchError } from "@/lib/research/errors";
import { researchFileExpired } from "@/lib/research/lifecycle";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const row = await db.researchEvidence.findFirst({
      where: {
        id: (await context.params).id,
        project: { userId: auth.userId! },
      },
    });
    if (!row) throw new ResearchError("NOT_FOUND", "证据不存在", 404);
    if (await researchFileExpired(row.taskId, row.purgedAt, row.expiresAt))
      throw new ResearchError(
        "FILE_EXPIRED",
        "原始材料已过期，来源链接仍可查看",
        410,
      );
    const screenshot =
      new URL(request.url).searchParams.get("kind") === "screenshot";
    const key = screenshot ? row.screenshotKey : row.contentKey;
    if (!key) throw new ResearchError("NOT_CAPTURED", "这份材料尚未留档", 404);
    return new Response(new Uint8Array(await readResearchFile(key)), {
      headers: {
        "Content-Type": screenshot ? "image/png" : "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return researchFailure(error);
  }
}
