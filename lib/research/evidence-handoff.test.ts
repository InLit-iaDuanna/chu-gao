// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildResearchEvidenceHandoff,
  type ResearchEvidenceHandoff,
} from "./evidence-handoff";
import {
  assessResearchQuality,
  packEvidenceContext,
  type EvidenceContextRow,
} from "./quality";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const brief = { question: "研究美国一体式轻食制作设备市场", market: "美国" };

function bodyRow(id: string, body: string): EvidenceContextRow {
  return {
    id,
    title: "Archived appliance comparison",
    originalUrl: `https://${id}.example/article`,
    content: body,
    contentHash: sha256(body),
    status: "captured",
  };
}

function manifest(row: EvidenceContextRow, quote: string) {
  const before = row.content!.slice(0, row.content!.indexOf(quote));
  const start = [...before].length;
  return {
    writerContextManifest: {
      sources: [
        {
          id: row.id,
          contentHash: row.contentHash,
          includedChars: [...quote].length,
          textScope: "retained_text",
          offsetUnit: "unicode_codepoints",
          rangeCoordinateSystem: "retained_text_unicode_codepoints",
          ranges: [
            { start, end: start + [...quote].length, sha256: sha256(quote) },
          ],
        },
      ],
    },
  };
}

describe("versioned evidence reading handoff", () => {
  it("converts Python codepoints using the actual body and preserves late original passages for review", () => {
    const quote =
      "The 🇺🇸 market definition excludes food ingredients and includes countertop appliances only.";
    const row = bodyRow(
      "prior",
      `😀 Retained heading.\n\n${"Earlier unrelated text.\n".repeat(100)}\n${quote}\n`,
    );
    const noise = {
      ...bodyRow("noise", "美国设备市场。".repeat(60)),
      title: "美国设备参数说明书",
    };
    const handoff = buildResearchEvidenceHandoff(
      [noise, row],
      [manifest(row, quote)],
    );
    expect(handoff.issues).toEqual([]);
    expect(handoff.selections[0].ranges[0]).toEqual({
      start: row.content!.indexOf(quote),
      end: row.content!.indexOf(quote) + quote.length,
      sha256: sha256(quote),
    });
    const packed = packEvidenceContext([noise, row], brief, {
      purpose: "review",
      handoff,
      maxSources: 1,
    });
    expect(packed.sources[0].id).toBe(row.id);
    expect(packed.sources[0].content).toContain(quote);
    expect(packed.sources[0].routing?.method).toBe("heuristic");
    expect(packed.sources[0].warnings).toContain(
      "candidate_read_for_review_not_decision_evidence",
    );
    expect(
      packed.manifest.sources.find((entry) => entry.evidenceId === row.id)
        ?.handoff,
    ).toMatchObject({
      status: "included",
      includedRequestedChars: quote.length,
    });
    expect(packed.usedChars).toBeLessThanOrEqual(32000);
  });

  it("keeps every question's retained reference ahead of same-language snippets without declaring it relevant", () => {
    const original = bodyRow(
      "writer",
      "This is a broad appliance forecast, not a measured market for the requested category.",
    );
    const newSource = bodyRow(
      "question",
      "This document discusses appliances but does not establish the requested population.",
    );
    const snippet: EvidenceContextRow = {
      id: "snippet",
      originalUrl: "https://noise.example",
      title: "美国设备参数市场调查",
      excerpt: "美国设备参数。",
      status: "link_only",
    };
    const handoff = buildResearchEvidenceHandoff(
      [snippet, original, newSource],
      [manifest(original, original.content!)],
      {
        questions: [
          { id: "q1", evidenceIds: [original.id] },
          { id: "q2", evidenceIds: [] },
        ],
        sourceIdsByQuestion: { q2: [newSource.id] },
      },
    );
    const packed = packEvidenceContext([snippet, original, newSource], brief, {
      purpose: "review",
      handoff,
      maxSources: 2,
    });
    expect(new Set(packed.sources.map((source) => source.id))).toEqual(
      new Set([original.id, newSource.id]),
    );
    expect(
      packed.sources.every((source) => source.contentKind === "captured_text"),
    ).toBe(true);
    expect(
      handoff.selections.find(
        (selection) => selection.evidenceId === newSource.id,
      )?.ranges,
    ).toEqual([]);
    expect(
      assessResearchQuality({
        evidence: [original, newSource],
        brief,
        requireDecisionRoutes: true,
      }).metrics.relevantCapturedSources,
    ).toBe(0);
  });

  it("never upgrades retained writer candidates through the synthesis route gate", () => {
    const row = bodyRow(
      "candidate",
      "A candidate appliance description from an unreviewed source.",
    );
    const handoff = buildResearchEvidenceHandoff(
      [row],
      [manifest(row, row.content!)],
    );
    const packed = packEvidenceContext([row], brief, {
      purpose: "synthesis",
      handoff,
      decisionRoutes: [],
      requireDecisionRoutes: true,
    });
    expect(packed.sources).toEqual([]);
    expect(packed.manifest.sources[0]).toMatchObject({
      omittedReason: "pending_decision_route",
      handoff: { status: "omitted" },
    });
  });

  it("does not inherit a legacy model route without an exact body version", () => {
    const row = bodyRow(
      "candidate",
      "Archived appliance facts still require a versioned review.",
    );
    const route = {
      evidenceId: row.id,
      role: "alternative" as const,
      decisionIds: ["q1"],
      reason: "Legacy test route, no source version was saved.",
    };
    for (const contentHash of [undefined, null]) {
      const packed = packEvidenceContext([row], brief, {
        purpose: "synthesis",
        decisionRoutes: [{ ...route, contentHash }],
        requireDecisionRoutes: true,
      });
      expect(packed.sources).toEqual([]);
      expect(packed.manifest.sources[0].assessment.reasons).toContain(
        "unversioned_decision_route",
      );
      expect(
        assessResearchQuality({
          evidence: [row],
          brief,
          decisionRoutes: [{ ...route, contentHash }],
          requireDecisionRoutes: true,
        }).metrics.relevantCapturedSources,
      ).toBe(0);
    }
  });

  it("preserves passages of a same-version model route, but an explicit irrelevant route still excludes them", () => {
    const row = bodyRow(
      "candidate",
      "The selected archived paragraph is not itself proof of a market statistic.",
    );
    const handoff = buildResearchEvidenceHandoff(
      [row],
      [manifest(row, row.content!)],
    );
    const route = {
      evidenceId: row.id,
      contentHash: row.contentHash,
      role: "background" as const,
      decisionIds: ["q1"],
      reason: "Offline route fixture only; not a live model assessment.",
    };
    const packed = packEvidenceContext([row], brief, {
      purpose: "synthesis",
      handoff,
      decisionRoutes: [route],
      requireDecisionRoutes: true,
    });
    expect(packed.sources[0].content).toContain(row.content);
    expect(packed.sources[0].routing).toMatchObject({
      method: "model_review",
      contentHash: row.contentHash,
      role: "background",
    });
    expect(packed.manifest.sources[0].assessment.routing?.contentHash).toBe(
      row.contentHash,
    );
    expect(
      packEvidenceContext([row], brief, {
        purpose: "review",
        handoff,
        decisionRoutes: [{ ...route, role: "irrelevant" }],
        requireDecisionRoutes: true,
      }).sources,
    ).toEqual([]);
  });

  it.each([
    [
      "body metadata",
      "body_version_mismatch",
      (row: EvidenceContextRow) => ({ ...row, contentHash: "f".repeat(64) }),
    ],
    [
      "body bytes",
      "body_hash_mismatch",
      (row: EvidenceContextRow) => ({
        ...row,
        content: `${row.content} Modified bytes.`,
      }),
    ],
    [
      "missing bytes",
      "unavailable_body",
      (row: EvidenceContextRow) => ({ ...row, content: undefined }),
    ],
    [
      "purged bytes",
      "unavailable_body",
      (row: EvidenceContextRow) => ({ ...row, purgedAt: new Date() }),
    ],
  ] as const)(
    "does not carry %s changes as the same reading",
    (_name, reason, change) => {
      const row = bodyRow(
        "candidate",
        "The original captured body with a bounded claim.",
      );
      const handoff = buildResearchEvidenceHandoff(
        [change(row)],
        [manifest(row, row.content!)],
      );
      expect(handoff.selections).toEqual([]);
      expect(handoff.issues[0].reason).toBe(reason);
    },
  );

  it("rejects a changed range hash and an out-of-bounds or overlapping interval", () => {
    const row = bodyRow("candidate", "The retained paragraph stays unchanged.");
    const original = manifest(row, row.content!);
    for (const ranges of [
      [
        {
          ...original.writerContextManifest.sources[0].ranges[0],
          sha256: "0".repeat(64),
        },
      ],
      [{ start: 0, end: 999999, sha256: sha256(row.content!) }],
      Array(2).fill(original.writerContextManifest.sources[0].ranges[0]),
    ]) {
      const result = structuredClone(original);
      result.writerContextManifest.sources[0].ranges = ranges;
      const handoff = buildResearchEvidenceHandoff([row], [result]);
      expect(handoff.selections).toEqual([]);
      expect(handoff.issues[0].reason).toMatch(
        /invalid_range|range_hash_mismatch/,
      );
    }
  });

  it("does not infer parent offsets for supplied snippets or manifests without coordinate metadata", () => {
    const row = bodyRow(
      "candidate",
      "Retained body available, but earlier snippet coordinates are not mapped.",
    );
    const result = manifest(row, row.content!);
    for (const textScope of ["supplied_snippets", ""]) {
      const input = structuredClone(result);
      input.writerContextManifest.sources[0].textScope = textScope;
      const handoff = buildResearchEvidenceHandoff([row], [input]);
      expect(handoff.selections).toEqual([]);
      expect(handoff.issues[0].reason).toBe("unsupported_coordinates");
    }
  });

  it("keeps encoded-payload coordinate transformations explicit instead of guessing a map", () => {
    const row = bodyRow(
      "encoded",
      "Image data:image/png;base64,AAAABBBB\nThe retained text after the payload.",
    );
    const handoff = buildResearchEvidenceHandoff(
      [row],
      [manifest(row, "The retained text after the payload.")],
    );
    expect(handoff.selections).toEqual([]);
    expect(handoff.issues[0].reason).toBe("source_text_policy_changed");
  });

  it("revalidates body bytes and ranges when a previously built handoff is packed", () => {
    const row = bodyRow("candidate", "Original body to carry forward exactly.");
    const handoff = buildResearchEvidenceHandoff(
      [row],
      [manifest(row, row.content!)],
    );
    const changed = { ...row, content: `${row.content} extra` };
    const packed = packEvidenceContext([changed], brief, {
      purpose: "review",
      handoff,
    });
    expect(packed.manifest.handoffIssues).toContainEqual({
      evidenceId: row.id,
      reason: "body_hash_mismatch",
    });
    expect(packed.manifest.sources[0].handoff).toBeUndefined();
    const badRange: ResearchEvidenceHandoff = structuredClone(handoff);
    badRange.selections[0].ranges[0].sha256 = "0".repeat(64);
    expect(
      packEvidenceContext([row], brief, {
        purpose: "review",
        handoff: badRange,
      }).manifest.handoffIssues,
    ).toContainEqual({ evidenceId: row.id, reason: "range_hash_mismatch" });
  });

  it("reports unknown or unavailable question references instead of admitting excerpt-only records as original text", () => {
    const snippet: EvidenceContextRow = {
      id: "snippet",
      originalUrl: "https://candidate.example",
      title: "Appliance",
      excerpt: "Search result summary only.",
      status: "link_only",
    };
    const handoff = buildResearchEvidenceHandoff([snippet], [], {
      questions: [{ id: "q", evidenceIds: ["snippet", "missing"] }],
    });
    expect(handoff.selections).toEqual([]);
    expect(handoff.issues).toEqual([
      { evidenceId: "snippet", reason: "unavailable_body" },
      { evidenceId: "missing", reason: "unknown_evidence" },
    ]);
  });

  it("records mandatory passage omissions under a real serialized budget and does not clip a table to conceal them", () => {
    const table =
      "| Product | complete observation |\n| --- | --- |\n" +
      Array.from(
        { length: 40 },
        (_, i) =>
          `| SKU-${i} | ${"Long qualified comparison text. ".repeat(4)} |`,
      ).join("\n");
    const row = bodyRow("table", table);
    const handoff = buildResearchEvidenceHandoff([row], [manifest(row, table)]);
    const packed = packEvidenceContext([row], brief, {
      purpose: "review",
      handoff,
      maxChars: 1600,
      perSourceChars: 900,
    });
    expect(packed.usedChars).toBeLessThanOrEqual(1600);
    expect(packed.sources).toEqual([]);
    expect(packed.manifest.sources[0]).toMatchObject({
      omittedReason: "budget",
      handoff: { status: "omitted", includedRequestedChars: 0 },
    });
    expect(packed.manifest.sources[0].handoff?.omittedRanges).toHaveLength(1);
  });

  it("does not let a handoff bypass an invalid URL", () => {
    const row = {
      ...bodyRow("bad-url", "Archived body remains present."),
      originalUrl: "javascript:bad()",
    };
    const handoff = buildResearchEvidenceHandoff(
      [row],
      [manifest(row, row.content!)],
    );
    expect(
      packEvidenceContext([row], brief, { purpose: "review", handoff }).manifest
        .sources[0].omittedReason,
    ).toBe("low_relevance");
  });

  it("does not replay an old isolated table cell as a complete comparison", () => {
    const rowLine =
      "| SKU-2 | 2026 | 120 USD | Only a candidate retail listing; tax is not included. |";
    const table =
      "| Product | Year | Price | Scope |\n| --- | --- | --- | --- |\n" +
      Array.from({ length: 40 }, (_, i) =>
        i === 2
          ? rowLine
          : `| SKU-${i} | unknown | unknown | Different category; no comparable price was observed. |`,
      ).join("\n");
    const row = bodyRow("isolated-table", table);
    const handoff = buildResearchEvidenceHandoff(
      [row],
      [manifest(row, rowLine)],
    );
    const packed = packEvidenceContext([row], brief, {
      purpose: "review",
      handoff,
      maxChars: 1700,
      perSourceChars: 900,
    });
    expect(packed.usedChars).toBeLessThanOrEqual(1700);
    expect(packed.sources).toEqual([]);
    expect(packed.manifest.sources[0].handoff).toMatchObject({
      status: "omitted",
      includedRequestedChars: 0,
    });
  });
});

