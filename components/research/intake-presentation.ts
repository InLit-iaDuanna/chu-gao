import { researchTerminal } from "@/lib/research/types";
import type {
  ResearchBriefInput,
  ResearchIntakeView,
} from "@/lib/research/types";

/** A previous successful reply must not approve a newer failed or active turn. */
export function currentIntakeResult(view: ResearchIntakeView | null) {
  return view?.task?.status === "completed" &&
    view.resultTaskId === view.task.id
    ? view.result
    : null;
}

/** Preserve the current reference selection after the first server restoration. */
export function intakeBrief(
  current: ResearchBriefInput,
  view: ResearchIntakeView,
  restored: boolean,
): ResearchBriefInput {
  const stored = view.task?.brief;
  const base =
    restored || !stored
      ? current
      : {
          ...current,
          ...stored,
          attachmentKeys: [
            ...new Set([...stored.attachmentKeys, ...current.attachmentKeys]),
          ],
          sourceImageIds: [
            ...new Set([...stored.sourceImageIds, ...current.sourceImageIds]),
          ],
          selectedMessageIds: [
            ...new Set([
              ...stored.selectedMessageIds,
              ...current.selectedMessageIds,
            ]),
          ],
          selectedContext: current.selectedContext || stored.selectedContext,
        };
  return { ...base, ...view.result?.brief };
}

/** Ignore a snapshot taken before the accepted answer became durable. */
export function intakeSnapshotIncludesTask(
  view: ResearchIntakeView,
  expectedTaskId: string | null,
  previous?: ResearchIntakeView | null,
) {
  if (previous && view.messages.length < previous.messages.length) return false;
  if (previous?.task && view.task?.id === previous.task.id) {
    if (view.task.nextSeq < previous.task.nextSeq) return false;
    if (
      researchTerminal(previous.task.status) &&
      !researchTerminal(view.task.status)
    ) {
      const previousAttempt = previous.task.stages.find(
        (stage) => stage.kind === "intake",
      )?.activeAttemptId;
      const nextAttempt = view.task.stages.find(
        (stage) => stage.kind === "intake",
      )?.activeAttemptId;
      if (
        view.task.nextSeq <= previous.task.nextSeq ||
        !nextAttempt ||
        nextAttempt === previousAttempt
      )
        return false;
    }
  }
  return (
    !expectedTaskId ||
    view.task?.id === expectedTaskId ||
    view.messages.some((message) => message.id === `${expectedTaskId}-user`)
  );
}
