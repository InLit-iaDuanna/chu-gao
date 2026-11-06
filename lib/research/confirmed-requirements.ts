import type { ResearchTask } from "@prisma/client";
import { db } from "@/lib/db";
import {
  confirmedIntakeRequirements,
  readIntakeConfirmationRequirements,
} from "./intake-contract";
import { readFinalResearchPackage } from "./workflow-quality";
import type { ResearchBriefInput } from "./types";

/** A queued research uses the confirmation frozen at creation, never later chat. */
export async function confirmedUserRequirements(
  task: ResearchTask,
  brief: ResearchBriefInput,
): Promise<string[]> {
  if (task.sourceTaskId) {
    const source = await db.researchStage.findFirst({
      where: {
        taskId: task.sourceTaskId,
        kind: "synthesize",
        status: "completed",
      },
    });
    const frozen = readFinalResearchPackage(
      (source?.result as { finalResearchPackage?: unknown } | null)
        ?.finalResearchPackage,
    );
    if (frozen) return frozen.finalBrief.confirmedRequirements;
    const original = await db.researchTask.findUniqueOrThrow({
      where: { id: task.sourceTaskId },
    });
    return confirmedUserRequirements(original, brief);
  }
  const config = task.configSnapshot as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(config, "intakeConfirmation"))
    return (
      readIntakeConfirmationRequirements(config.intakeConfirmation, brief) ?? []
    );

  // Compatibility for tasks queued before immutable intake confirmations existed.
  // The latest turn is authoritative even if it failed or revoked an older ready.
  const latest = await db.researchTask.findFirst({
    where: {
      projectId: task.projectId,
      userId: task.userId,
      preset: "intake",
      createdAt: { lte: task.createdAt },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { stages: { where: { kind: "intake", status: "completed" } } },
  });
  // A direct API request with no intake history still supplies its own goal.
  if (!latest) return [brief.question];
  if (latest.status !== "completed") return [];
  const intake = (
    latest.configSnapshot as {
      intake?: {
        answer?: string;
        history?: Array<{ role: string; content: string }>;
      };
    }
  ).intake;
  const userMessages = [
    ...(intake?.history ?? [])
      .filter(
        (message) =>
          message.role === "user" && typeof message.content === "string",
      )
      .map((message) => message.content),
    ...(typeof intake?.answer === "string" ? [intake.answer] : []),
  ];
  return (
    confirmedIntakeRequirements(
      latest.stages[0]?.result,
      userMessages,
      brief,
    ) ?? []
  );
}
