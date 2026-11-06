import type { Prisma, ResearchTask } from "@prisma/client";
import { db } from "@/lib/db";
import { ResearchError } from "./errors";

type VersionTask = Pick<
  ResearchTask,
  "id" | "userId" | "projectId" | "sourceTaskId"
>;

export function researchOutputBasis(
  task: Pick<ResearchTask, "id" | "sourceTaskId" | "plan">,
) {
  const stages = (task.plan as { stages?: Array<{ kind?: string }> } | null)
    ?.stages;
  return stages?.some((stage) => stage.kind === "synthesize")
    ? task.id
    : (task.sourceTaskId ?? task.id);
}

/** Resolve retained versions without allowing references to another project or owner. */
export async function researchVersionTaskIds(
  task: VersionTask,
  client: Pick<Prisma.TransactionClient, "researchTask"> = db,
) {
  const ids = [task.id];
  let sourceId = task.sourceTaskId;
  while (sourceId) {
    if (ids.includes(sourceId) || ids.length >= 16)
      throw new ResearchError(
        "INVALID_SOURCE_VERSION",
        "研究版本引用成环或层级过深，请选择原始研究版本",
        409,
      );
    const source = await client.researchTask.findFirst({
      where: { id: sourceId, userId: task.userId, projectId: task.projectId },
      select: { id: true, sourceTaskId: true },
    });
    if (!source)
      throw new ResearchError(
        "INVALID_SOURCE_VERSION",
        "来源研究不存在或不属于当前项目",
        409,
      );
    ids.push(source.id);
    sourceId = source.sourceTaskId;
  }
  return ids;
}
