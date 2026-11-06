import {
  assessResearchQuality,
  type EvidenceContextRow,
  type EvidenceDecisionRoute,
} from "./quality";
import type { ResearchBriefInput } from "./types";

/** Availability is measured on the passages actually supplied to the writer.
 * A captured body outside this context cannot authorize a substantive report.
 */
export function synthesisReadiness(input: {
  brief: ResearchBriefInput;
  loadedEvidence: readonly EvidenceContextRow[];
  sources: readonly { id: string; content: string; contentKind: string }[];
  decisionRoutes?: readonly EvidenceDecisionRoute[];
  requireDecisionRoutes: boolean;
}) {
  const readIds = new Set(
    input.sources
      .filter(
        (source) =>
          ["captured_text", "user_provided_text"].includes(
            source.contentKind,
          ) && source.content.trim(),
      )
      .map((source) => source.id),
  );
  const rows = input.loadedEvidence.filter((row) => readIds.has(row.id));
  const quality = assessResearchQuality({
    evidence: rows,
    brief: input.brief,
    decisionRoutes: input.decisionRoutes?.filter((route) =>
      readIds.has(route.evidenceId),
    ),
    requireDecisionRoutes: input.requireDecisionRoutes,
  });
  return {
    canWriteResearch:
      quality.metrics.relevantCapturedSources > 0 ||
      quality.metrics.providedTextSources > 0,
    readSourceIds: [...readIds],
    quality,
  };
}

