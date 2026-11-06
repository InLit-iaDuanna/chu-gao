import { z } from "zod";
import {
  researchDeliverablesSchemaV3,
  researchVersion,
} from "./workflow-quality";
import { ResearchError } from "./errors";

// This is an application completion record, not a provider resume token.
export const SYNTHESIS_CHECKPOINT_VERSION = "synthesis-resume-v2";
export type SynthesisPhase = "draft" | "report" | "metadata";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const completedTextSchema = z
  .object({
    text: z.string().min(1).max(500000),
    hash,
    attemptId: z.string().min(1),
    responseId: z.string().nullable(),
    completedAt: z.iso.datetime(),
  })
  .strict();
const checkpointSchema = z
  .object({
    version: z.literal(SYNTHESIS_CHECKPOINT_VERSION),
    inputHash: hash,
    draft: completedTextSchema,
    report: completedTextSchema.extend({ draftHash: hash }).strict().optional(),
    metadata: z
      .object({
        value: researchDeliverablesSchemaV3,
        hash,
        reportHash: hash,
        attemptId: z.string().min(1),
        responseId: z.string().nullable(),
        completedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SynthesisCheckpoint = z.infer<typeof checkpointSchema>;
export type SynthesisMetadata = z.infer<typeof researchDeliverablesSchemaV3>;
export interface CompletedSynthesisText {
  status: string;
  text: string;
  responseId?: string | null;
}

export function restoreSynthesisCheckpoint(
  value: unknown,
  inputHash: string,
): SynthesisCheckpoint | null {
  const parsed = checkpointSchema
    .omit({ report: true, metadata: true })
    .extend({
      report: z.unknown().optional(),
      metadata: z.unknown().optional(),
    })
    .safeParse(value);
  if (!parsed.success) return null;
  const { report: rawReport, metadata: rawMetadata, ...record } = parsed.data;
  if (
    record.inputHash !== inputHash ||
    !record.draft.text.trim() ||
    record.draft.hash !== researchVersion(record.draft.text)
  )
    return null;
  // Invalidate a damaged child and its descendants, preserving completed parents.
  const parsedReport = checkpointSchema.shape.report.safeParse(rawReport);
  const candidate = parsedReport.success ? parsedReport.data : undefined;
  const report =
    candidate &&
    candidate.text.trim() &&
    candidate.draftHash === record.draft.hash &&
    candidate.hash === researchVersion(candidate.text)
      ? candidate
      : undefined;
  if (!report) return { ...record, report: undefined, metadata: undefined };
  const parsedMetadata = checkpointSchema.shape.metadata.safeParse(rawMetadata);
  const metadata = parsedMetadata.success ? parsedMetadata.data : undefined;
  return metadata &&
    metadata.reportHash === report.hash &&
    metadata.hash === researchVersion(metadata.value)
    ? { ...record, report, metadata }
    : { ...record, report, metadata: undefined };
}

/** A v1 report was never passed through the independent editorial contract. */
export function assertSynthesisCheckpointVersion(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "version" in value &&
    value.version !== SYNTHESIS_CHECKPOINT_VERSION
  )
    throw new ResearchError(
      "SYNTHESIS_CHECKPOINT_VERSION",
      "这份成文记录来自旧版流程，当前不能直接继续。原记录已保留，请由管理员处理旧版任务，或重新发起研究。",
      409,
    );
}

function requireCompleted(result: CompletedSynthesisText) {
  if (result.status !== "completed" || !result.text.trim())
    throw new ResearchError(
      "SYNTHESIS_NOT_COMPLETED",
      "模型未明确完成有效正文，片段仍保留；没有将它保存为可复用的完成结果",
      502,
    );
}

/** Only runs inside an already-authorized stage attempt. There is no retry loop.
 * Persistence is awaited before the next paid call. A crash before persistence
 * remains an uncertain call; this cannot promise physical exactly-once requests.
 */
export async function runResumableSynthesis(input: {
  inputHash: string;
  attemptId: string;
  stored: unknown;
  writeDraft: () => Promise<CompletedSynthesisText>;
  validateDraft: (draft: string) => void;
  writeReport: (draft: string) => Promise<CompletedSynthesisText>;
  validateReport: (report: string, draft: string) => void;
  phaseStarted: (phase: SynthesisPhase) => Promise<void>;
  publishReport: (report: string) => Promise<void>;
  writeMetadata: (report: string) => Promise<CompletedSynthesisText>;
  validateMetadata: (value: SynthesisMetadata, report: string) => void;
  persist: (record: SynthesisCheckpoint) => Promise<void>;
  reused: (phase: SynthesisPhase, attemptId: string) => Promise<void>;
}) {
  assertSynthesisCheckpointVersion(input.stored);
  let checkpoint = restoreSynthesisCheckpoint(input.stored, input.inputHash);
  if (input.stored != null && !checkpoint)
    throw new ResearchError(
      "SYNTHESIS_CHECKPOINT_MISMATCH",
      "已保存的成文输入或草稿校验不一致，原完成记录已保留。请由管理员核对原输入与记录后再继续，或重新发起研究。",
      409,
    );
  if (!checkpoint) {
    await input.phaseStarted("draft");
    const result = await input.writeDraft();
    requireCompleted(result);
    input.validateDraft(result.text);
    checkpoint = {
      version: SYNTHESIS_CHECKPOINT_VERSION,
      inputHash: input.inputHash,
      draft: {
        text: result.text,
        hash: researchVersion(result.text),
        attemptId: input.attemptId,
        responseId: result.responseId ?? null,
        completedAt: new Date().toISOString(),
      },
    };
    await input.persist(checkpoint);
  } else {
    input.validateDraft(checkpoint.draft.text);
    await input.reused("draft", checkpoint.draft.attemptId);
  }
  if (!checkpoint.report) {
    await input.phaseStarted("report");
    const result = await input.writeReport(checkpoint.draft.text);
    requireCompleted(result);
    input.validateReport(result.text, checkpoint.draft.text);
    checkpoint = {
      ...checkpoint,
      report: {
        text: result.text,
        hash: researchVersion(result.text),
        draftHash: checkpoint.draft.hash,
        attemptId: input.attemptId,
        responseId: result.responseId ?? null,
        completedAt: new Date().toISOString(),
      },
      metadata: undefined,
    };
    await input.persist(checkpoint);
  } else {
    input.validateReport(checkpoint.report.text, checkpoint.draft.text);
    await input.reused("report", checkpoint.report.attemptId);
  }
  const report = checkpoint.report!;
  await input.publishReport(report.text);
  if (!checkpoint.metadata) {
    await input.phaseStarted("metadata");
    const result = await input.writeMetadata(report.text);
    requireCompleted(result);
    const value = researchDeliverablesSchemaV3.parse(JSON.parse(result.text));
    input.validateMetadata(value, report.text);
    checkpoint = {
      ...checkpoint,
      metadata: {
        value,
        hash: researchVersion(value),
        reportHash: report.hash,
        attemptId: input.attemptId,
        responseId: result.responseId ?? null,
        completedAt: new Date().toISOString(),
      },
    };
    await input.persist(checkpoint);
  } else {
    input.validateMetadata(checkpoint.metadata.value, report.text);
    await input.reused("metadata", checkpoint.metadata.attemptId);
  }
  // Callers merge open questions and presentation caveats into their own copy.
  return {
    report: report.text,
    metadata: structuredClone(checkpoint.metadata!.value),
    checkpoint,
  };
}

