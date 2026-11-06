import { describe, expect, it, vi } from "vitest";
import {
  restoreSynthesisCheckpoint,
  runResumableSynthesis,
  SYNTHESIS_CHECKPOINT_VERSION,
  type CompletedSynthesisText,
  type SynthesisCheckpoint,
  type SynthesisMetadata,
  type SynthesisPhase,
} from "./synthesis-checkpoint";
import { researchVersion } from "./workflow-quality";

const metadata: SynthesisMetadata = {
  finalBrief: {
    goal: "核对当前材料能够回答的研究问题",
    scope: "只使用本轮明确提供的来源与范围",
    alternatives: [],
    acceptanceCriteria: [],
    openQuestions: [],
  },
  hypotheses: [],
  competitors: [],
  caveats: [],
  decisionCards: [],
};
const draft =
  "# 研究草稿\n\n英国来源记载了产品的清洗限制 [cm_source_001]。美国适用性尚未确定。";
const report =
  "# 当前发现\n\n现有材料能说明清洗限制，但还不能说明美国市场适用性。依据来自英国页面 [cm_source_001]。";
const sourceIdentity = {
  model: "fixture-model",
  effort: "high",
  sourceHash: "body-v1",
  prompt: "v1",
};
const identity = researchVersion(sourceIdentity);
const phases: SynthesisPhase[] = ["draft", "report", "metadata"];

function savedPhase(record: SynthesisCheckpoint): SynthesisPhase {
  return record.metadata ? "metadata" : record.report ? "report" : "draft";
}

function harness(stored?: unknown) {
  const records: SynthesisCheckpoint[] = [];
  const events: string[] = [];
  const input = {
    inputHash: identity,
    attemptId: "attempt-a",
    stored,
    writeDraft: vi.fn(async (): Promise<CompletedSynthesisText> => {
      events.push("write:draft");
      return { status: "completed", text: draft, responseId: "response-draft" };
    }),
    validateDraft: vi.fn<(draft: string) => void>(),
    writeReport: vi.fn<(draft: string) => Promise<CompletedSynthesisText>>(
      async () => {
        events.push("write:report");
        return {
          status: "completed",
          text: report,
          responseId: "response-report",
        };
      },
    ),
    validateReport: vi.fn<(report: string, draft: string) => void>(),
    phaseStarted: vi.fn(async (phase: SynthesisPhase) => {
      events.push(`phase:${phase}`);
    }),
    publishReport: vi.fn<(report: string) => Promise<void>>(async () => {
      events.push("publish");
    }),
    writeMetadata: vi.fn<(report: string) => Promise<CompletedSynthesisText>>(
      async () => {
        events.push("write:metadata");
        return {
          status: "completed",
          text: JSON.stringify(metadata),
          responseId: "response-metadata",
        };
      },
    ),
    validateMetadata:
      vi.fn<(metadata: SynthesisMetadata, report: string) => void>(),
    persist: vi.fn(async (record: SynthesisCheckpoint) => {
      records.push(structuredClone(record));
      events.push(`persist:${savedPhase(record)}`);
    }),
    reused: vi.fn(async (phase: SynthesisPhase, attemptId: string) => {
      events.push(`reuse:${phase}:${attemptId}`);
    }),
  } satisfies Parameters<typeof runResumableSynthesis>[0];
  return { input, records, events };
}

function writes(run: ReturnType<typeof harness>) {
  return [run.input.writeDraft, run.input.writeReport, run.input.writeMetadata];
}

async function completedFixture() {
  return (await runResumableSynthesis(harness().input)).checkpoint;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("v2 synthesis completion boundaries (model and persistence simulated)", () => {
  it("persists each completed parent before starting the next phase and binds both child hashes", async () => {
    const run = harness();
    const result = await runResumableSynthesis(run.input);
    expect(run.events).toEqual([
      "phase:draft",
      "write:draft",
      "persist:draft",
      "phase:report",
      "write:report",
      "persist:report",
      "publish",
      "phase:metadata",
      "write:metadata",
      "persist:metadata",
    ]);
    expect(run.input.writeReport).toHaveBeenCalledExactlyOnceWith(draft);
    expect(run.input.writeMetadata).toHaveBeenCalledExactlyOnceWith(report);
    expect(result.checkpoint.version).toBe(SYNTHESIS_CHECKPOINT_VERSION);
    expect(result.checkpoint.draft.hash).toBe(researchVersion(draft));
    expect(result.checkpoint.report!.draftHash).toBe(
      result.checkpoint.draft.hash,
    );
    expect(result.checkpoint.report!.hash).toBe(researchVersion(report));
    expect(result.checkpoint.metadata!.reportHash).toBe(
      result.checkpoint.report!.hash,
    );
    expect(result.checkpoint.metadata!.hash).toBe(researchVersion(metadata));
    expect(run.records.map(savedPhase)).toEqual(phases);
    expect(run.records[0].report).toBeUndefined();
    expect(run.records[1].metadata).toBeUndefined();
  });

  it("an editor failure preserves the draft; an explicit new attempt only edits and builds metadata", async () => {
    const first = harness();
    first.input.writeReport.mockRejectedValueOnce(
      new Error("editor stream failed"),
    );
    await expect(runResumableSynthesis(first.input)).rejects.toThrow(
      "editor stream failed",
    );
    expect(first.records).toHaveLength(1);
    expect(first.records[0].draft.text).toBe(draft);
    expect(first.input.writeMetadata).not.toHaveBeenCalled();
    expect(first.input.publishReport).not.toHaveBeenCalled();
    const retry = harness(first.records[0]);
    retry.input.attemptId = "explicit-attempt-b";
    const result = await runResumableSynthesis(retry.input);
    expect(retry.input.writeDraft).not.toHaveBeenCalled();
    expect(retry.input.writeReport).toHaveBeenCalledExactlyOnceWith(draft);
    expect(retry.input.writeMetadata).toHaveBeenCalledExactlyOnceWith(report);
    expect(retry.input.phaseStarted.mock.calls.map(([phase]) => phase)).toEqual(
      ["report", "metadata"],
    );
    expect(result.checkpoint.draft.attemptId).toBe("attempt-a");
    expect(result.checkpoint.report!.attemptId).toBe("explicit-attempt-b");
    expect(result.checkpoint.metadata!.attemptId).toBe("explicit-attempt-b");
  });

  it("a metadata failure retains both completed texts and only retries metadata explicitly", async () => {
    const first = harness();
    first.input.writeMetadata.mockRejectedValueOnce(
      new Error("metadata failed"),
    );
    await expect(runResumableSynthesis(first.input)).rejects.toThrow(
      "metadata failed",
    );
    expect(first.records.map(savedPhase)).toEqual(["draft", "report"]);
    const retry = harness(first.records[1]);
    retry.input.attemptId = "explicit-attempt-b";
    const result = await runResumableSynthesis(retry.input);
    expect(retry.input.writeDraft).not.toHaveBeenCalled();
    expect(retry.input.writeReport).not.toHaveBeenCalled();
    expect(retry.input.writeMetadata).toHaveBeenCalledExactlyOnceWith(report);
    expect(retry.input.phaseStarted).toHaveBeenCalledExactlyOnceWith(
      "metadata",
    );
    expect(result.checkpoint.report!.attemptId).toBe("attempt-a");
    expect(result.checkpoint.metadata!.attemptId).toBe("explicit-attempt-b");
  });

  it("validated full checkpoints replay publication with zero model calls or phase budget reservations", async () => {
    const stored = await completedFixture();
    const retry = harness(stored);
    await runResumableSynthesis(retry.input);
    for (const write of writes(retry)) expect(write).not.toHaveBeenCalled();
    expect(retry.input.phaseStarted).not.toHaveBeenCalled();
    expect(retry.input.persist).not.toHaveBeenCalled();
    expect(retry.input.validateDraft).toHaveBeenCalledExactlyOnceWith(draft);
    expect(retry.input.validateReport).toHaveBeenCalledExactlyOnceWith(
      report,
      draft,
    );
    expect(retry.input.validateMetadata).toHaveBeenCalledExactlyOnceWith(
      metadata,
      report,
    );
    expect(retry.input.publishReport).toHaveBeenCalledExactlyOnceWith(report);
    expect(retry.input.reused.mock.calls).toEqual(
      phases.map((phase) => [phase, "attempt-a"]),
    );
  });

  it.each(
    phases.flatMap((phase) =>
      ["failed", "in_progress", "unknown"].map(
        (status) => [phase, status] as const,
      ),
    ),
  )(
    "never checkpoints nonempty %s output with status %s",
    async (phase, status) => {
      const run = harness();
      const index = phases.indexOf(phase);
      writes(run)[index].mockResolvedValueOnce({
        status,
        text: "retained partial text",
      });
      await expect(runResumableSynthesis(run.input)).rejects.toMatchObject({
        code: "SYNTHESIS_NOT_COMPLETED",
      });
      expect(run.records).toHaveLength(index);
      writes(run).forEach((write, position) =>
        expect(write).toHaveBeenCalledTimes(position <= index ? 1 : 0),
      );
    },
  );

  it.each(phases)(
    "never checkpoints whitespace-only completed %s output",
    async (phase) => {
      const run = harness();
      const index = phases.indexOf(phase);
      writes(run)[index].mockResolvedValueOnce({
        status: "completed",
        text: " \n\t ",
      });
      await expect(runResumableSynthesis(run.input)).rejects.toMatchObject({
        code: "SYNTHESIS_NOT_COMPLETED",
      });
      expect(run.records).toHaveLength(index);
      expect(run.input.persist).toHaveBeenCalledTimes(index);
      writes(run)
        .slice(index + 1)
        .forEach((write) => expect(write).not.toHaveBeenCalled());
    },
  );

  it.each(phases)(
    "a %s checkpoint commit failure stops all downstream work without an automatic replay",
    async (phase) => {
      const run = harness();
      const originalPersist = run.input.persist.getMockImplementation()!;
      run.input.persist.mockImplementation(async (record) => {
        if (savedPhase(record) === phase)
          throw new Error(`uncertain ${phase} commit`);
        await originalPersist(record);
      });
      const index = phases.indexOf(phase);
      await expect(runResumableSynthesis(run.input)).rejects.toThrow(
        `uncertain ${phase} commit`,
      );
      expect(run.records).toHaveLength(index);
      expect(run.input.persist).toHaveBeenCalledTimes(index + 1);
      writes(run).forEach((write, position) =>
        expect(write).toHaveBeenCalledTimes(position <= index ? 1 : 0),
      );
      expect(run.input.publishReport).toHaveBeenCalledTimes(
        phase === "metadata" ? 1 : 0,
      );
    },
  );

  it.each(["draft", "report"] as const)(
    "waits for an unresolved %s commit before making the next paid call",
    async (phase) => {
      const run = harness();
      const saved = deferred();
      const release = deferred();
      const originalPersist = run.input.persist.getMockImplementation()!;
      run.input.persist.mockImplementation(async (record) => {
        if (savedPhase(record) === phase) {
          saved.resolve();
          await release.promise;
        }
        await originalPersist(record);
      });
      const pending = runResumableSynthesis(run.input);
      await saved.promise;
      const next = writes(run)[phases.indexOf(phase) + 1];
      expect(next).not.toHaveBeenCalled();
      release.resolve();
      await pending;
      expect(next).toHaveBeenCalledTimes(1);
    },
  );

  it.each(phases)(
    "a %s phase budget preflight failure prevents its call and all children",
    async (phase) => {
      const run = harness();
      run.input.phaseStarted.mockImplementation(async (next) => {
        if (next === phase) throw new Error("phase budget unavailable");
      });
      const index = phases.indexOf(phase);
      await expect(runResumableSynthesis(run.input)).rejects.toThrow(
        "phase budget unavailable",
      );
      expect(run.records).toHaveLength(index);
      writes(run).forEach((write, position) =>
        expect(write).toHaveBeenCalledTimes(position < index ? 1 : 0),
      );
      expect(run.input.phaseStarted).toHaveBeenCalledTimes(index + 1);
    },
  );

  it.each(phases)(
    "a failed %s validation leaves only previously validated parents",
    async (phase) => {
      const run = harness();
      const validators = [
        run.input.validateDraft,
        run.input.validateReport,
        run.input.validateMetadata,
      ];
      const index = phases.indexOf(phase);
      validators[index].mockImplementationOnce(() => {
        throw new Error("validation refused");
      });
      await expect(runResumableSynthesis(run.input)).rejects.toThrow(
        "validation refused",
      );
      expect(run.records).toHaveLength(index);
      writes(run)
        .slice(index + 1)
        .forEach((write) => expect(write).not.toHaveBeenCalled());
    },
  );

  it.each([
    "not json",
    JSON.stringify({ finalBrief: { goal: "missing required fields" } }),
  ])(
    "does not cache malformed or structurally invalid metadata: %s",
    async (text) => {
      const run = harness();
      run.input.writeMetadata.mockResolvedValueOnce({
        status: "completed",
        text,
      });
      await expect(runResumableSynthesis(run.input)).rejects.toThrow();
      expect(run.records.map(savedPhase)).toEqual(["draft", "report"]);
      expect(run.input.validateMetadata).not.toHaveBeenCalled();
    },
  );

  it("a publication failure preserves the edited report and stops before metadata", async () => {
    const first = harness();
    first.input.publishReport.mockRejectedValueOnce(
      new Error("publication unavailable"),
    );
    await expect(runResumableSynthesis(first.input)).rejects.toThrow(
      "publication unavailable",
    );
    expect(first.records.map(savedPhase)).toEqual(["draft", "report"]);
    expect(first.input.writeMetadata).not.toHaveBeenCalled();
    const retry = harness(first.records[1]);
    await runResumableSynthesis(retry.input);
    expect(retry.input.writeDraft).not.toHaveBeenCalled();
    expect(retry.input.writeReport).not.toHaveBeenCalled();
    expect(retry.input.writeMetadata).toHaveBeenCalledExactlyOnceWith(report);
  });

  it("rejects v1 immediately rather than silently treating an old report as a new draft", async () => {
    const old = {
      ...(await completedFixture()),
      version: "synthesis-resume-v1",
    };
    const run = harness(old);
    await expect(runResumableSynthesis(run.input)).rejects.toMatchObject({
      code: "SYNTHESIS_CHECKPOINT_VERSION",
    });
    for (const write of writes(run)) expect(write).not.toHaveBeenCalled();
    expect(run.input.phaseStarted).not.toHaveBeenCalled();
    expect(run.input.persist).not.toHaveBeenCalled();
    expect(run.input.publishReport).not.toHaveBeenCalled();
  });

  it.each([
    ["source", { sourceHash: "body-v2" }],
    ["model", { model: "other-model" }],
    ["effort", { effort: "low" }],
    ["prompt", { prompt: "v2" }],
  ])(
    "changed %s identity refuses reuse and refuses to silently regenerate",
    async (_name, change) => {
      const stored = await completedFixture();
      const run = harness(stored);
      run.input.inputHash = researchVersion({ ...sourceIdentity, ...change });
      expect(
        restoreSynthesisCheckpoint(stored, run.input.inputHash),
      ).toBeNull();
      await expect(runResumableSynthesis(run.input)).rejects.toMatchObject({
        code: "SYNTHESIS_CHECKPOINT_MISMATCH",
      });
      for (const write of writes(run)) expect(write).not.toHaveBeenCalled();
      expect(run.input.phaseStarted).not.toHaveBeenCalled();
      expect(run.input.persist).not.toHaveBeenCalled();
      expect(stored.draft.text).toBe(draft);
    },
  );

  it("corrupt draft bytes or a malformed stored checkpoint cause mismatch without any new call", async () => {
    const damaged = await completedFixture();
    damaged.draft.text += " unexpected mutation";
    for (const stored of [damaged, {}, "corrupted record"]) {
      const run = harness(stored);
      await expect(runResumableSynthesis(run.input)).rejects.toMatchObject({
        code: "SYNTHESIS_CHECKPOINT_MISMATCH",
      });
      for (const write of writes(run)) expect(write).not.toHaveBeenCalled();
      expect(run.input.phaseStarted).not.toHaveBeenCalled();
    }
  });

  it.each(["body", "draft binding", "shape"])(
    "damaged report %s invalidates only report and metadata",
    async (damage) => {
      const stored = await completedFixture();
      if (damage === "body") stored.report!.text += " unexpected mutation";
      if (damage === "draft binding") stored.report!.draftHash = "f".repeat(64);
      const value =
        damage === "shape" ? { ...stored, report: { text: report } } : stored;
      const restored = restoreSynthesisCheckpoint(value, identity);
      expect(restored?.draft.text).toBe(draft);
      expect(restored?.report).toBeUndefined();
      expect(restored?.metadata).toBeUndefined();
      const retry = harness(value);
      await runResumableSynthesis(retry.input);
      expect(retry.input.writeDraft).not.toHaveBeenCalled();
      expect(retry.input.writeReport).toHaveBeenCalledExactlyOnceWith(draft);
      expect(retry.input.writeMetadata).toHaveBeenCalledExactlyOnceWith(report);
    },
  );

  it.each(["draft binding", "value", "shape"])(
    "damaged metadata %s preserves both completed texts",
    async (damage) => {
      const stored = await completedFixture();
      expect(stored.draft.hash).not.toBe(stored.report!.hash);
      if (damage === "draft binding")
        stored.metadata!.reportHash = stored.draft.hash;
      if (damage === "value")
        stored.metadata!.value.caveats.push("unhashed mutation");
      const value =
        damage === "shape"
          ? { ...stored, metadata: { value: "broken" } }
          : stored;
      const restored = restoreSynthesisCheckpoint(value, identity);
      expect(restored?.draft.text).toBe(draft);
      expect(restored?.report?.text).toBe(report);
      expect(restored?.metadata).toBeUndefined();
      const retry = harness(value);
      await runResumableSynthesis(retry.input);
      expect(retry.input.writeDraft).not.toHaveBeenCalled();
      expect(retry.input.writeReport).not.toHaveBeenCalled();
      expect(retry.input.writeMetadata).toHaveBeenCalledExactlyOnceWith(report);
    },
  );

  it("cached children are revalidated before publication without silently rewriting a refused cache", async () => {
    const run = harness(await completedFixture());
    run.input.validateReport.mockImplementationOnce(() => {
      throw new Error("new guard refused cached text");
    });
    await expect(runResumableSynthesis(run.input)).rejects.toThrow(
      "new guard refused cached text",
    );
    for (const write of writes(run)) expect(write).not.toHaveBeenCalled();
    expect(run.input.publishReport).not.toHaveBeenCalled();
    expect(run.input.validateMetadata).not.toHaveBeenCalled();
    expect(run.input.persist).not.toHaveBeenCalled();
  });

  it("returns metadata as a copy so application additions cannot poison a valid completion checkpoint", async () => {
    const first = await runResumableSynthesis(harness().input);
    first.metadata.finalBrief.openQuestions.push("application-only question");
    first.metadata.caveats.push("application-only caveat");
    expect(first.checkpoint.metadata!.value.finalBrief.openQuestions).toEqual(
      [],
    );
    expect(first.checkpoint.metadata!.value.caveats).toEqual([]);
    expect(first.checkpoint.metadata!.hash).toBe(researchVersion(metadata));
    const restored = restoreSynthesisCheckpoint(first.checkpoint, identity);
    expect(restored?.metadata).toBeDefined();
    const retry = await runResumableSynthesis(harness(first.checkpoint).input);
    retry.metadata.finalBrief.openQuestions.push("later merge");
    expect(first.checkpoint.metadata!.value.finalBrief.openQuestions).toEqual(
      [],
    );
    expect(retry.checkpoint.metadata!.value.finalBrief.openQuestions).toEqual(
      [],
    );
  });
});

