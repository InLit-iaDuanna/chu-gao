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
    const file = await db.researchArtifact.findFirst({
      where: {
        id: (await context.params).id,
        project: { userId: auth.userId! },
      },
    });
    if (!file) throw new ResearchError("NOT_FOUND", "研究文件不存在", 404);
    if (await researchFileExpired(file.taskId, file.purgedAt, file.expiresAt))
      throw new ResearchError("FILE_EXPIRED", "研究文件已过期", 410);
    return new Response(
      new Uint8Array(await readResearchFile(file.storageKey)),
      {
        headers: {
          "Content-Type": file.mimeType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return researchFailure(error);
  }
}
