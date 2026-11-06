import { db } from "@/lib/db";
import { readResearchFile } from "@/lib/research/storage";
import { researchAdmin, researchFailure } from "@/lib/research/http";
import { ResearchError } from "@/lib/research/errors";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const row = await db.researchAttachment.findFirst({
      where: {
        id: (await context.params).id,
        project: { userId: auth.userId! },
        purgedAt: null,
      },
    });
    if (!row)
      throw new ResearchError("FILE_EXPIRED", "参考文件已过期或不存在", 410);
    if (row.expiresAt <= new Date()) {
      const active = await db.researchTask.findMany({
        where: {
          projectId: row.projectId,
          status: { in: ["queued", "running"] },
        },
        select: { brief: { select: { content: true } } },
      });
      if (
        !active.some((task) =>
          (
            (task.brief.content as { attachmentKeys?: string[] })
              .attachmentKeys ?? []
          ).includes(`attachment:${row.id}`),
        )
      )
        throw new ResearchError("FILE_EXPIRED", "参考文件已过期", 410);
    }
    return new Response(
      new Uint8Array(await readResearchFile(row.storageKey)),
      {
        headers: {
          "Content-Type": row.mimeType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return researchFailure(error);
  }
}
