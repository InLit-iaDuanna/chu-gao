// Recorded public-source replay. No search, model, network, or database calls.
// Run from source/: node --import tsx validation/replay-evidence-v3.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const load = async (name) => {
  const module = await import(name);
  return module.default ?? module;
};
const {
  assessResearchQuality,
  packEvidenceContext,
  validateEvidenceDecisionRoutes,
} = await load("../lib/research/quality.ts");
const { researchSourceText } = await load("../lib/research/source-text.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.resolve(
  root,
  process.env.CHUGAO_REPLAY_OUTPUT ?? "validation",
);
fs.mkdirSync(outputDir, { recursive: true });
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(root, "lib/research/quality-v3-case.fixture.json"),
    "utf8",
  ),
);
const { brief, evidence } = fixture;
const ids = {
  official: "cmve7lk8x00wf3yyzt7apwo35",
  retail: "cmve7lka700wl3yyz7savsb8c",
  experience: "cmve7t3j6003p3yo8zoxvte8w",
  website: "cmve7llcj00xv3yyz4dzvitk3",
  remoteApp: "cmve7lldl00xz3yyzjb99wd8n",
  iceMaker: "cmve7lmu100yz3yyzn4lvb5cf",
};
const packed = packEvidenceContext(evidence, brief);
const byId = new Map(
  packed.manifest.sources.map((source) => [source.evidenceId, source]),
);
const experience = packed.sources.find(
  (source) => source.id === ids.experience,
);
const original = evidence.find((source) => source.id === ids.experience);
const checks = [];
const check = (name, run) => {
  run();
  checks.push({ name, passed: true });
};
check("all_105_candidates_and_10_retained_bodies", () => {
  assert.equal(evidence.length, 105);
  assert.equal(evidence.filter((source) => source.content).length, 10);
});
check("generic_brand_page_and_adjacent_appliance_retained", () => {
  assert.equal(byId.get(ids.official).assessment.decision, "keep");
  assert.equal(byId.get(ids.experience).assessment.decision, "keep");
});
check("website_example_is_not_product_evidence", () => {
  assert.equal(byId.get(ids.website).assessment.decision, "review");
  assert.equal(
    byId.get(ids.website).assessment.routing.role,
    "design_reference",
  );
});
check("complete_nine_minute_sequence_and_sponsored_sample_disclosure", () => {
  for (const phrase of [
    "花了三分钟切了午餐肉块",
    "三分钟后，简单美味的馅料",
    "前后花了9分钟左右",
    "本文商品由什么值得买提供",
  ])
    assert.ok(experience.content.includes(phrase), phrase);
});
check("unchanged_source_identity_and_replayable_utf16_ranges", () => {
  assert.equal(experience.contentHash, original.contentHash);
  const body = researchSourceText(original.content);
  for (const range of experience.contentRanges)
    assert.ok(experience.content.includes(body.slice(range.start, range.end)));
  assert.equal(
    experience.includedChars,
    experience.contentRanges.reduce(
      (total, range) => total + range.end - range.start,
      0,
    ),
  );
});
check("serialized_application_budget", () => {
  assert.equal(
    packed.usedChars,
    JSON.stringify({ sources: packed.sources, diagnostics: packed.diagnostics })
      .length,
  );
  assert.ok(packed.usedChars <= 32000);
});

// This explicit routing fixture was authored from the recorded material to
// exercise the contract. It is not the result of a fresh semantic model call.
const routes = [
  [ids.official, "product_identity", ["product_identity"]],
  [ids.retail, "product_identity", ["product_identity"]],
  [ids.experience, "alternative", ["complete_task", "fit_and_cleanup"]],
  [ids.website, "design_reference", []],
  [ids.remoteApp, "background", []],
  [ids.iceMaker, "irrelevant", []],
].map(([evidenceId, role, decisionIds]) => ({
  evidenceId,
  role,
  decisionIds,
  contentHash: evidence.find((row) => row.id === evidenceId).contentHash,
  reason:
    "Offline manually reviewed routing fixture; this does not certify factual support or model classification accuracy.",
}));
validateEvidenceDecisionRoutes(
  routes,
  evidence.map((row) => row.id),
  ["product_identity", "complete_task", "fit_and_cleanup"],
);
const formal = packEvidenceContext(evidence, brief, {
  decisionRoutes: routes,
  requireDecisionRoutes: true,
});
const quality = assessResearchQuality({
  evidence,
  brief,
  decisionRoutes: routes,
  requireDecisionRoutes: true,
  unresolvedQuestions: 3,
});
check("formal_evidence_requires_reviewed_roles", () => {
  assert.ok(
    formal.sources.every((source) => source.routing.method === "model_review"),
  );
  assert.ok(!formal.sources.some((source) => source.id === ids.iceMaker));
  assert.equal(quality.metrics.relevantCapturedSources, 3);
  assert.equal(quality.status, "draft");
});
check("content_change_invalidates_old_routing", () => {
  const changed = evidence.map((row) =>
    row.id === ids.experience ? { ...row, contentHash: "a".repeat(64) } : row,
  );
  const replay = packEvidenceContext(changed, brief, {
    decisionRoutes: routes,
    requireDecisionRoutes: true,
  });
  assert.ok(!replay.sources.some((source) => source.id === ids.experience));
  assert.ok(
    replay.manifest.sources
      .find((source) => source.evidenceId === ids.experience)
      .assessment.reasons.includes("stale_decision_route"),
  );
});

const result = {
  status: "passed",
  scope:
    "Actual TypeScript quality functions over the recorded 105-source case. Semantic routes are a manually reviewed offline fixture. No model, network, database, new fact verification, or paid research was performed.",
  node: process.version,
  sourceHashes: Object.fromEntries(
    [
      "lib/research/quality.ts",
      "lib/research/source-text.ts",
      "lib/research/quality-v3-case.fixture.json",
    ].map((name) => [
      name,
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, name)))
        .digest("hex"),
    ]),
  ),
  checks,
  selectedCandidates: packed.sources.map((source) => ({
    id: source.id,
    title: source.title,
    includedChars: source.includedChars,
    contentKind: source.contentKind,
    routing: source.routing,
  })),
  usedChars: packed.usedChars,
  originalSequenceExcerpt: experience,
  formalReviewedIds: formal.sources.map((source) => source.id),
  formalMetrics: quality.metrics,
  caveats: [
    "One product observed through multiple channels is not multiple independent competitor products.",
    "Heuristic roles remain unreviewed candidate leads; matching an object does not prove a fact.",
    "The time sequence and structure descriptions come from one platform-supplied review sample, not an independently measured office-user study.",
  ],
};
const output = path.join(outputDir, "evidence-v3-replay.json");
fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
// The Python selector can replay the same retained source text with the actual
// TypeScript triage output, without substituting manual semantic routes.
const candidatesOutput = path.join(outputDir, "evidence-v3-candidates.json");
fs.writeFileSync(
  candidatesOutput,
  JSON.stringify(
    {
      provenance: fixture.provenance,
      scope:
        "Recorded source bodies with actual heuristic quality/routing. No semantic model review or source refetch.",
      brief,
      evidence: evidence.map((row) => ({
        ...row,
        quality: byId.get(row.id).assessment,
      })),
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(
  JSON.stringify(
    {
      output,
      candidatesOutput,
      checks: checks.length,
      usedChars: packed.usedChars,
      retainedOriginalCandidates: evidence.length,
      formalMetrics: quality.metrics,
    },
    null,
    2,
  ) + "\n",
);
