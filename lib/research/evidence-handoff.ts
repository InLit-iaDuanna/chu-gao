import { createHash } from "node:crypto";
import type { EvidenceContextRow } from "./quality";
import { researchSourceText } from "./source-text";

export interface EvidenceHandoffRange {
  /** Offsets in researchSourceText(retained body), in UTF-16 code units. */
  start: number;
  end: number;
  sha256: string;
}

export interface EvidenceHandoffSelection {
  evidenceId: string;
  contentHash: string;
  reason: "prior_research_basis" | "verification_question";
  decisionIds: string[];
  coordinateSystem: "retained_text_utf16";
  ranges: EvidenceHandoffRange[];
}

export interface EvidenceHandoffIssue {
  evidenceId: string;
  reason:
    | "unknown_evidence"
    | "unavailable_body"
    | "body_version_mismatch"
    | "body_hash_mismatch"
    | "missing_ranges"
    | "unsupported_coordinates"
    | "source_text_policy_changed"
    | "invalid_range"
    | "range_hash_mismatch";
}

export interface ResearchEvidenceHandoff {
  schemaVersion: 1;
  selections: EvidenceHandoffSelection[];
  issues: EvidenceHandoffIssue[];
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function bodyIssue(
  row: EvidenceContextRow | undefined,
  expectedHash?: unknown,
): EvidenceHandoffIssue["reason"] | null {
  if (!row) return "unknown_evidence";
  if (!row.content?.trim() || row.purgedAt || row.status === "purged")
    return "unavailable_body";
  if (
    !validHash(row.contentHash) ||
    (expectedHash !== undefined && expectedHash !== row.contentHash)
  )
    return "body_version_mismatch";
  if (sha256(row.content) !== row.contentHash) return "body_hash_mismatch";
  return null;
}

function validUtf16Boundary(text: string, offset: number) {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  );
}

function checkedRanges(
  value: unknown,
  body: string,
  codepoints: boolean,
): { ranges: EvidenceHandoffRange[]; issue?: EvidenceHandoffIssue["reason"] } {
  if (!Array.isArray(value) || !value.length)
    return { ranges: [], issue: "missing_ranges" };
  if (value.length > 256) return { ranges: [], issue: "invalid_range" };
  // Convert only after the actual retained bytes are loaded and verified. A
  // Python offset cannot be used directly as a JavaScript slice boundary.
  const boundaries = [0];
  if (codepoints)
    for (const char of body) boundaries.push(boundaries.at(-1)! + char.length);
  const length = codepoints ? boundaries.length - 1 : body.length;
  const ranges: EvidenceHandoffRange[] = [];
  for (const input of value) {
    const range = record(input);
    if (
      !range ||
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      Number(range.start) < 0 ||
      Number(range.end) <= Number(range.start) ||
      Number(range.end) > length ||
      !validHash(range.sha256)
    )
      return { ranges: [], issue: "invalid_range" };
    const start = codepoints
      ? boundaries[Number(range.start)]
      : Number(range.start);
    const end = codepoints ? boundaries[Number(range.end)] : Number(range.end);
    if (!validUtf16Boundary(body, start) || !validUtf16Boundary(body, end))
      return { ranges: [], issue: "invalid_range" };
    if (sha256(body.slice(start, end)) !== range.sha256)
      return { ranges: [], issue: "range_hash_mismatch" };
    ranges.push({ start, end, sha256: range.sha256 });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  if (ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end))
    return { ranges: [], issue: "invalid_range" };
  return { ranges };
}

function mergeRanges(ranges: EvidenceHandoffRange[], body: string) {
  const merged: EvidenceHandoffRange[] = [];
  for (const range of [...ranges].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      previous.sha256 = sha256(body.slice(previous.start, previous.end));
    } else merged.push({ ...range });
  }
  return merged;
}

/**
 * Carry reading provenance, never source relevance or factual support. Question
 * references can request a fresh reading; only an exact prior manifest can
 * claim that the same original passages were carried forward.
 */
export function buildResearchEvidenceHandoff(
  rows: readonly EvidenceContextRow[],
  results: readonly unknown[],
  options: {
    questions?: readonly { id: string; evidenceIds: readonly string[] }[];
    sourceIdsByQuestion?: Readonly<Record<string, readonly string[]>>;
  } = {},
): ResearchEvidenceHandoff {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selections = new Map<string, EvidenceHandoffSelection>();
  const issues: EvidenceHandoffIssue[] = [];
  const issue = (
    evidenceId: string,
    reason: EvidenceHandoffIssue["reason"],
  ) => {
    if (
      !issues.some(
        (item) => item.evidenceId === evidenceId && item.reason === reason,
      )
    )
      issues.push({ evidenceId, reason });
  };
  for (const result of results) {
    const manifest = record(record(result)?.writerContextManifest);
    for (const input of Array.isArray(manifest?.sources)
      ? manifest.sources
      : []) {
      const source = record(input);
      if (
        !source ||
        typeof source.id !== "string" ||
        !(Number(source.includedChars) > 0)
      )
        continue;
      const row = byId.get(source.id);
      const invalid = bodyIssue(row, source.contentHash);
      if (invalid) {
        issue(source.id, invalid);
        continue;
      }
      if (
        source.textScope !== "retained_text" ||
        source.rangeCoordinateSystem !== "retained_text_unicode_codepoints" ||
        source.offsetUnit !== "unicode_codepoints"
      ) {
        issue(source.id, "unsupported_coordinates");
        continue;
      }
      const body = row!.content!;
      // Encoded payload replacement changes coordinate space. Do not invent a
      // map across that transformation or across supplied-snippet omissions.
      if (researchSourceText(body) !== body) {
        issue(source.id, "source_text_policy_changed");
        continue;
      }
      const checked = checkedRanges(source.ranges, body, true);
      if (checked.issue) {
        issue(source.id, checked.issue);
        continue;
      }
      const previous = selections.get(source.id);
      selections.set(source.id, {
        evidenceId: source.id,
        contentHash: row!.contentHash!,
        reason: previous?.reason ?? "prior_research_basis",
        decisionIds: previous?.decisionIds ?? [],
        coordinateSystem: "retained_text_utf16",
        ranges: mergeRanges(
          [...(previous?.ranges ?? []), ...checked.ranges],
          body,
        ),
      });
    }
  }
  for (const question of options.questions ?? []) {
    const ids = new Set([
      ...question.evidenceIds,
      ...(options.sourceIdsByQuestion?.[question.id] ?? []),
    ]);
    for (const id of ids) {
      const row = byId.get(id);
      const invalid = bodyIssue(row);
      if (invalid) {
        issue(id, invalid);
        continue;
      }
      const previous = selections.get(id);
      selections.set(id, {
        evidenceId: id,
        contentHash: row!.contentHash!,
        reason: "verification_question",
        decisionIds: [
          ...new Set([...(previous?.decisionIds ?? []), question.id]),
        ],
        coordinateSystem: "retained_text_utf16",
        ranges: previous?.ranges ?? [],
      });
    }
  }
  return { schemaVersion: 1, selections: [...selections.values()], issues };
}

/** The packer rechecks current bytes, so stale/mutated handoffs cannot become pins. */
export function validateResearchEvidenceHandoff(
  rows: readonly EvidenceContextRow[],
  handoff?: ResearchEvidenceHandoff,
): ResearchEvidenceHandoff {
  if (!handoff) return { schemaVersion: 1, selections: [], issues: [] };
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selections: EvidenceHandoffSelection[] = [];
  const issues = [...handoff.issues];
  const seen = new Set<string>();
  for (const selection of handoff.selections) {
    const row = byId.get(selection.evidenceId);
    let invalid = bodyIssue(row, selection.contentHash);
    if (
      !invalid &&
      (seen.has(selection.evidenceId) ||
        selection.coordinateSystem !== "retained_text_utf16")
    )
      invalid = "invalid_range";
    const checked =
      invalid || !selection.ranges.length
        ? { ranges: [], issue: undefined }
        : checkedRanges(
            selection.ranges,
            researchSourceText(row!.content!),
            false,
          );
    invalid ??= checked.issue ?? null;
    if (invalid) {
      issues.push({ evidenceId: selection.evidenceId, reason: invalid });
      continue;
    }
    seen.add(selection.evidenceId);
    selections.push({ ...selection, ranges: checked.ranges });
  }
  return { schemaVersion: 1, selections, issues };
}

