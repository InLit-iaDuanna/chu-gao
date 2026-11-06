import { ok } from "@/lib/api-response";
import { researchAdmin, researchFailure } from "@/lib/research/http";
import { researchTaskView } from "@/lib/research/service";
import { db } from "@/lib/db";
import { ResearchError } from "@/lib/research/errors";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const id = (await context.params).id;
    if (new URL(request.url).searchParams.get("meta") === "1") {
      const meta = await db.researchTask.findFirst({
        where: { id, userId: auth.userId! },
        select: { id: true, status: true, nextSeq: true },
      });
      if (!meta) throw new ResearchError("NOT_FOUND", "研究任务不存在", 404);
      return ok(meta);
    }
    return ok(await researchTaskView(auth.userId!, id));
  } catch (error) {
    return researchFailure(error);
  }
}
