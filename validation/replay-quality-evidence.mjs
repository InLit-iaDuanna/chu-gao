/**
 * Offline case regression. Run from the project root:
 *   node --import tsx validation/replay-quality-evidence.mjs
 * Or pass the attached archive's extracted `case` directory to read full bodies:
 *   node --import tsx validation/replay-quality-evidence.mjs /path/to/case
 * No API, database, network or model call is made.
 */
import fs from "node:fs/promises";
import path from "node:path";
const load = async (name) => {
  const module = await import(name);
  return module.default ?? module;
};
const {
  packEvidenceContext,
  assessResearchQuality,
  buildSearchQueries,
  validateEvidenceIds,
} = await load("../lib/research/quality.ts");
const { researchSourceText } = await load("../lib/research/source-text.ts");

const caseDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
let rows;
let brief;
let reportText;
if (caseDir) {
  const raw = JSON.parse(
    await fs.readFile(path.join(caseDir, "evidence/index.json"), "utf8"),
  );
  brief = JSON.parse(
    await fs.readFile(path.join(caseDir, "brief-versions.json"), "utf8"),
  ).at(-1).content;
  rows = [];
  for (const row of raw) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(row.id))
      throw new Error("Invalid fixture ID");
    let content;
    try {
      content = await fs.readFile(
        path.join(caseDir, "evidence", row.id, "source.md"),
        "utf8",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    rows.push({ ...row, content });
  }
  reportText = await fs.readFile(
    path.join(caseDir, "stages/synthesize/final.md"),
    "utf8",
  );
} else {
  const fixture = JSON.parse(
    await fs.readFile(
      new URL("../lib/research/quality-case.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  rows = fixture.evidence;
  brief = fixture.brief;
  reportText =
    "Regression fixture: report not included; material sufficiency only.";
}

let remaining = 32000;
const old = rows.map((row) => {
  const rawText = researchSourceText(row.content ?? row.excerpt ?? "");
  const text = rawText.slice(0, Math.min(4000, remaining));
  remaining -= text.length;
  return {
    id: row.id,
    includedChars: text.length,
    capturedChars:
      typeof row.content === "string"
        ? researchSourceText(row.content).length
        : null,
  };
});
const packed = packEvidenceContext(rows, brief, {
  maxChars: 32000,
  perSourceChars: 4000,
  focus: "核对 Ochama 小米 电饭煲 电饭锅 650W 的历史参数与当前适用性",
});
const defaultPack = packEvidenceContext(rows, brief, {
  maxChars: 32000,
  perSourceChars: 4000,
});
const targetId = "cmve0eoyd00k73yyzjoxgl20o";
const target = packed.sources.find((row) => row.id === targetId);
// Historical report IDs must be assessed against the historical 55-source set.
// Its source-list IDs absent from this NEW selection are not historical invented IDs.
const historicalMembership = validateEvidenceIds(
  reportText,
  rows.map((row) => row.id),
);
const quality = assessResearchQuality({
  evidence: rows,
  brief,
  executionCompleted: true,
  reportText,
  unresolvedQuestions: 3,
  allowedEvidenceIds: rows.map((row) => row.id),
});
const summary = {
  schemaVersion: 1,
  inputMode: caseDir
    ? "attached_full_captured_bodies"
    : "portable_sampled_fixture",
  boundary:
    "Offline deterministic replay, not an upstream wire capture or a new research run. Fixture noise bodies are sampled when no case directory is supplied. Lexical triage and source inclusion do not establish claim truth or current price validity.",
  evidenceCount: rows.length,
  capturedCount: rows.filter((row) => typeof row.content === "string").length,
  queryPlan: buildSearchQueries(brief),
  previousInsertionOrderPacking: old.find((row) => row.id === targetId),
  newFocusPacking: {
    usedChars: packed.usedChars,
    maxChars: packed.maxChars,
    sourceCount: packed.sources.length,
    target: packed.manifest.sources.find((row) => row.evidenceId === targetId),
    contains650W: target?.content.includes("650W") ?? false,
    containsHistoricalPrice: target?.content.includes("46.99欧") ?? false,
    omittedByReason: packed.diagnostics.omittedByReason,
  },
  newDefaultPacking: {
    usedChars: defaultPack.usedChars,
    target: defaultPack.manifest.sources.find(
      (row) => row.evidenceId === targetId,
    ),
    rejectedNoiseSources: defaultPack.manifest.sources
      .filter((row) => row.omittedReason === "low_relevance")
      .map((row) => ({ id: row.evidenceId, kind: row.assessment.sourceKind })),
  },
  historicalReportMembership: historicalMembership,
  quality,
};
const file = new URL(
  caseDir
    ? "../output/research-v2-integration/quality-evidence-replay.json"
    : "../output/research-v2-integration/quality-evidence-fixture-replay.json",
  import.meta.url,
);
await fs.mkdir(new URL("./", file), { recursive: true });
await fs.writeFile(file, JSON.stringify(summary, null, 2) + "\n");
if (
  !target ||
  !target.content.includes("650W") ||
  packed.usedChars > packed.maxChars ||
  quality.status !== "insufficient"
) {
  console.error("Evidence replay regression failed; inspect", file.pathname);
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        file: file.pathname,
        inputMode: summary.inputMode,
        evidenceCount: rows.length,
        capturedCount: summary.capturedCount,
        oldTargetIncluded: summary.previousInsertionOrderPacking.includedChars,
        newTargetIncluded: target.includedChars,
        targetBodyChars: target.capturedChars,
        hardBudgetUsed: packed.usedChars,
        rejectedNoiseSources:
          summary.newDefaultPacking.rejectedNoiseSources.length,
        historicalUnknownIds: historicalMembership.unknownIds.length,
        qualityStatus: quality.status,
      },
      null,
      2,
    ),
  );
}
