import { db } from "@/lib/db";
import { ok } from "@/lib/api-response";
import { researchAdmin, researchFailure } from "@/lib/research/http";
import { ResearchError } from "@/lib/research/errors";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const project = await db.researchProject.findFirst({
      where: { id: (await context.params).id, userId: auth.userId! },
      include: {
        briefs: { orderBy: { revision: "desc" }, take: 1 },
        tasks: {
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, preset: true, createdAt: true },
          take: 50,
        },
      },
    });
    if (!project) throw new ResearchError("NOT_FOUND", "研究项目不存在", 404);
    return ok(project);
  } catch (error) {
    return researchFailure(error);
  }
}
