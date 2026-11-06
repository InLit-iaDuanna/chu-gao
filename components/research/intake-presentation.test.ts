import { describe, expect, it } from "vitest";
import {
  currentIntakeResult,
  intakeBrief,
  intakeSnapshotIncludesTask,
} from "./intake-presentation";
import { intakeInput, intakeView } from "./ResearchIntake.fixture";

describe("intake approval and snapshot boundaries", () => {
  it("requires the completed result to belong to the current task", () => {
    const ready = intakeView({ ready: true, reply: "方向已整理。" });
    expect(currentIntakeResult(ready)?.ready).toBe(true);
    expect(
      currentIntakeResult({ ...ready, resultTaskId: "other-turn" }),
    ).toBeNull();
    expect(
      currentIntakeResult({
        ...ready,
        task: { ...ready.task!, status: "running" },
      }),
    ).toBeNull();
  });
  it("does not roll back completed or newer conversation snapshots", () => {
    const previous = intakeView();
    const current = intakeView({
      id: "next-turn",
      previous,
      ready: true,
      reply: "更新完成。",
    });
    expect(intakeSnapshotIncludesTask(previous, null, current)).toBe(false);
    expect(intakeSnapshotIncludesTask(previous, "next-turn", previous)).toBe(
      false,
    );
    expect(intakeSnapshotIncludesTask(current, "next-turn", previous)).toBe(
      true,
    );
    expect(
      intakeSnapshotIncludesTask(
        { ...current, task: { ...current.task!, status: "running" } },
        null,
        current,
      ),
    ).toBe(false);
  });
  it("allows a legitimate newer retry attempt to leave an earlier terminal state", () => {
    const failed = intakeView({ status: "failed" });
    const retry = intakeView({ status: "running" });
    retry.task!.nextSeq = failed.task!.nextSeq + 2;
    retry.task!.stages[0].activeAttemptId = "new-retry-attempt";
    expect(intakeSnapshotIncludesTask(retry, null, failed)).toBe(true);
    retry.task!.stages[0].activeAttemptId =
      failed.task!.stages[0].activeAttemptId;
    expect(intakeSnapshotIncludesTask(retry, null, failed)).toBe(false);
  });
  it("restores server references once and then respects additions and removals in the local selection", () => {
    const view = intakeView();
    view.task!.brief.attachmentKeys = ["stored.pdf"];
    const current = intakeInput().brief;
    current.attachmentKeys = ["new-reference.pdf"];
    expect(intakeBrief(current, view, false).attachmentKeys).toEqual([
      "stored.pdf",
      "new-reference.pdf",
    ]);
    expect(intakeBrief(current, view, true).attachmentKeys).toEqual([
      "new-reference.pdf",
    ]);
    current.attachmentKeys = [];
    expect(intakeBrief(current, view, true).attachmentKeys).toEqual([]);
  });
});
