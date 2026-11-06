import { ResearchError } from "./errors";
import { validateEvidenceIds } from "./quality";

export const EDITORIAL_GUARD_VERSION =
  "citation-lineage-and-numeric-literals-v1";

function numericLiterals(text: string, citationIds: readonly string[]) {
  let prose = text.normalize("NFKC");
  for (const id of citationIds) prose = prose.split(`[${id}]`).join("");
  prose = prose
    .replace(/https?:\/\/[^\s<>)\]]+/g, "")
    .replace(/^[ \t]{0,8}(?:#{1,6}[ \t]+)?\d+(?:[.)][ \t]+|、)/gm, "");
  return new Set(
    [...prose.matchAll(/\d+(?:[.,]\d+)*/g)].map(([literal]) => {
      const ungrouped = literal.replace(/,(?=\d{3}(?:\D|$))/g, "");
      return /^\d+(?:\.\d+)?$/.test(ungrouped)
        ? ungrouped.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1")
        : ungrouped;
    }),
  );
}

/** An editorial integrity guard, not a claim-entailment or fact-checking model.
 * The editor may reorganize prose, not introduce additional research claims.
 * Numeric formatting and list numbering may change; factual values may not.
 */
export function validateEditorialReport(
  report: string,
  draft: string,
  allowedEvidenceIds: readonly string[],
) {
  const original = validateEvidenceIds(draft, allowedEvidenceIds);
  // Parse every explicitly mapped source alias before enforcing the draft-only
  // lineage. Some aliases are not recognizable without the full source map.
  const edited = validateEvidenceIds(report, allowedEvidenceIds);
  if (!original.valid || !original.referencedIds.length)
    throw new ResearchError(
      "INVALID_EDITORIAL_DRAFT",
      "成文草稿缺少可追溯的来源引用，草稿已保留。",
      502,
    );
  const missing = original.referencedIds.filter(
    (id) => !edited.referencedIds.includes(id),
  );
  const added = edited.referencedIds.filter(
    (id) => !original.referencedIds.includes(id),
  );
  if (!edited.valid || missing.length || added.length)
    throw new ResearchError(
      "INVALID_EDITORIAL_REFERENCE",
      "编辑稿新增了未绑定来源，或丢失草稿中的来源引用。编辑片段和完成草稿均已保留。",
      502,
      {
        reason: JSON.stringify({
          unknownIds: edited.unknownIds,
          addedIds: added,
          missingIds: missing,
        }),
      },
    );
  const draftNumbers = numericLiterals(draft, original.referencedIds);
  const addedNumbers = [
    ...numericLiterals(report, edited.referencedIds),
  ].filter((literal) => !draftNumbers.has(literal));
  if (addedNumbers.length)
    throw new ResearchError(
      "EDITORIAL_NEW_NUMERIC_VALUE",
      "编辑稿出现草稿没有的数字值，未将其发布为研究结论；请继续成文核对。",
      502,
      {
        reason: `added_numeric_literals:${addedNumbers.slice(0, 20).join(",")}`,
      },
    );
  return {
    citedEvidenceIds: edited.referencedIds,
    guard: EDITORIAL_GUARD_VERSION,
    semanticClaimsVerified: false,
  };
}

