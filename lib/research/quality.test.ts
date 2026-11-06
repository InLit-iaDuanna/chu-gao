import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import caseFixture from "./quality-case.fixture.json";
import v3CaseFixture from "./quality-v3-case.fixture.json";
import {
  assessCandidate,
  assessResearchQuality,
  buildSearchQueries,
  normalizeResearchSearchQuery,
  packEvidenceContext,
  researchBasisEvidenceIds,
  validateEvidenceIds,
  validateEvidenceDecisionRoutes,
  type EvidenceDecisionRoute,
  type EvidenceContextRow,
  type QualityBrief,
} from "./quality";
import { researchSourceText, researchTextBlocks } from "./source-text";

const brief: QualityBrief = caseFixture.brief;
const caseEvidence: EvidenceContextRow[] = caseFixture.evidence;
const v3Brief: QualityBrief = v3CaseFixture.brief;
const v3Evidence: EvidenceContextRow[] = v3CaseFixture.evidence;
const cookingBrief: QualityBrief = {
  question: "比较办公室午餐电饭锅与其他烹饪方案",
  audience: "办公室员工",
  constraints: "清洁方便",
};

describe("research evidence handoff", () => {
  it("keeps the same retained source version ahead of old lexical noise without verifying its claims", () => {
    const source = {
      ...captured(
        "prior-source",
        "Thermomix TM7 cooking system",
        "This archived appliance comparison is a candidate source only. It cannot establish the size of the United States market. Cleaning and preparation are separate tasks requiring further measurement.",
      ),
      contentHash: "a".repeat(64),
    };
    const noise = captured(
      "old-noise",
      "美国设备参数说明书",
      "美国设备参数和市场竞争格局。".repeat(20),
    );
    const rows = [noise, source];
    const results = [
      {
        writerContextManifest: {
          sources: [
            {
              id: source.id,
              contentHash: source.contentHash,
              includedChars: 100,
            },
          ],
        },
      },
    ];
    const preferredEvidenceIds = researchBasisEvidenceIds(rows, results);
    expect(preferredEvidenceIds).toEqual([source.id]);
    const packed = packEvidenceContext(
      rows,
      { question: "美国一体式轻食制作设备市场" },
      { maxSources: 1, preferredEvidenceIds },
    );
    expect(packed.sources.map((row) => row.id)).toEqual([source.id]);
    expect(packed.sources[0].authority).toBe("unverified");
    expect(
      packed.manifest.sources.find((row) => row.evidenceId === source.id)
        ?.selectionPriority,
    ).toBe("prior_research_basis");
  });

  it("does not carry over changed, expired, missing or omitted body versions", () => {
    const source = {
      ...captured("source", "Appliance record", "Known retained source body."),
      contentHash: "a".repeat(64),
    };
    const results = [
      {
        writerContextManifest: {
          sources: [
            { id: "source", contentHash: "a".repeat(64), includedChars: 20 },
          ],
        },
      },
    ];
    expect(
      researchBasisEvidenceIds(
        [{ ...source, contentHash: "b".repeat(64) }],
        results,
      ),
    ).toEqual([]);
    expect(
      researchBasisEvidenceIds([{ ...source, purgedAt: new Date() }], results),
    ).toEqual([]);
    expect(
      researchBasisEvidenceIds([{ ...source, content: undefined }], results),
    ).toEqual([]);
    expect(
      researchBasisEvidenceIds(
        [source],
        [
          {
            writerContextManifest: {
              sources: [
                {
                  id: "source",
                  contentHash: source.contentHash,
                  includedChars: 0,
                },
              ],
            },
          },
        ],
      ),
    ).toEqual([]);
  });
});

function captured(
  id: string,
  title: string,
  content: string,
  url = `https://${id}.example/products/cooker`,
): EvidenceContextRow {
  return {
    id,
    title,
    content,
    excerpt: `${title} ${content.slice(0, 500)}`,
    originalUrl: url,
    status: "captured",
  };
}

describe("bounded research queries", () => {
  it("splits the actual brief into purposeful compact searches without inventing a market or cutoff", () => {
    const plan = buildSearchQueries(brief);
    expect(plan.map((item) => item.purpose)).toEqual([
      "identify_products",
      "compare_alternatives",
      "understand_use",
      "test_constraints",
    ]);
    expect(new Set(plan.map((item) => item.query)).size).toBe(plan.length);
    expect(plan[0].query).toContain("轻食机");
    expect(plan[0].query).toContain("参数 说明书");
    expect(plan[1].query).toContain("办公室快速午餐");
    expect(plan[1].query).toContain("轻食机");
    for (const item of plan) {
      expect(item.query.length).toBeLessThanOrEqual(160);
      expect(item.query).not.toMatch(
        /中国|2025-12-31|2026|已确认|待确认|constraints:/,
      );
      expect(item.provenance).toBe("heuristic");
      expect(item.question).toBeTruthy();
    }
    expect(
      buildSearchQueries({
        question: "Design a portable blender for office lunches",
      })[0].query,
    ).toContain("manual");
  });

  it("preserves the full US appliance subject and market in every initial query instead of searching a country plus generic intent", () => {
    const actual = {
      question:
        "研究美国一体式轻食制作设备市场，重点分析市场规模与发展趋势、消费者需求及竞品格局。",
      market: "美国",
    };
    for (const row of buildSearchQueries(actual, { maxQueries: 4 })) {
      expect(row.query).toContain("一体式轻食制作设备");
      expect(row.query).toContain("美国");
      expect(row.query).not.toMatch(/^美国 (?:参数|替代方案|使用体验|限制)/);
      expect(row.query).not.toContain("Thermomix");
    }
    expect(
      normalizeResearchSearchQuery("美国 参数 说明书", actual),
    ).toMatchObject({ reason: "missing_subject", changed: true });
    expect(
      normalizeResearchSearchQuery("美国 参数 说明书", actual).query,
    ).toContain("一体式轻食制作设备");
    const translated =
      '"all-in-one cooking system" United States market methodology';
    expect(normalizeResearchSearchQuery(translated, actual)).toEqual({
      query: translated,
      changed: false,
      reason: "unchanged",
    });
  });

  it("keeps named tools in the initial queries before later-stage budgets truncate the plan", () => {
    const plan = buildSearchQueries(
      {
        question:
          "为设计工作台比较 Crawl4AI 与 Playwright 的网页采集和截图能力。",
        market: "自建网页采集工具选型",
        audience: "设计工作台开发者",
        competitors: ["Crawl4AI", "Playwright"],
      },
      { maxQueries: 4 },
    );
    expect(plan).toHaveLength(4);
    for (const query of plan)
      expect(query.query).toMatch(/Crawl4AI|Playwright/);
    expect(plan[1].query).toMatch(/Crawl4AI.*Playwright/);
  });

  it("preserves short focused operator queries and detects the old full-brief shape", () => {
    const focused = 'site:example.com "AB-123" user manual';
    expect(normalizeResearchSearchQuery(focused, brief)).toEqual({
      query: focused,
      changed: false,
      reason: "unchanged",
    });
    const legacy = `目标：${brief.question}\n市场：${brief.market}\n人群：${brief.audience}\n约束：${brief.constraints}`;
    const result = normalizeResearchSearchQuery(legacy, brief);
    expect(result.reason).toBe("brief_detected");
    expect(result.query.length).toBeLessThan(legacy.length);
    expect(result.query).toBe(buildSearchQueries(brief)[0].query);
    expect(normalizeResearchSearchQuery(" ", brief).query).toBe("");
  });

  it("retains named competitors and does not replace a long focused query with an unrelated stock query", () => {
    const plan = buildSearchQueries({
      question: "为户外摄影设计相机包",
      competitors: ["Peak Design Everyday 20L"],
    });
    expect(plan.at(-1)?.query).toContain("Peak Design Everyday 20L");
    const long = `site:example.com 相机包 防水 拉链测试 ${"户外摄影下雨保护 ".repeat(40)}`;
    const compact = normalizeResearchSearchQuery(long, {
      question: "设计相机包",
    });
    expect(compact.reason).toBe("query_compacted");
    expect(compact.query).toContain("site:example.com");
    expect(compact.query).toContain("拉链");
    expect(compact.query.length).toBeLessThanOrEqual(180);
  });
});

describe("candidate triage, not authority or truth scoring", () => {
  it("flags actual corpus, word-list, sitemap, feed and fiction hits for this appliance brief", () => {
    const expected = new Map([
      ["cmvdzhf9r00d93yyzpgix6hgs", "corpus"],
      ["cmvdzhwp500ej3yyzhtvv1efo", "corpus"],
      ["cmvdzhwpi00el3yyz5esgo0hj", "directory"],
      ["cmvdzhwpt00en3yyzd069z4pi", "feed"],
      ["cmve0eoq600j13yyz9s2nv48o", "fiction"],
      ["cmve0eopy00iz3yyzbvo9s9kx", "directory"],
    ]);
    for (const [id, kind] of expected) {
      const row = caseEvidence.find((item) => item.id === id)!;
      const result = assessCandidate(
        { url: row.originalUrl!, title: row.title, excerpt: row.excerpt },
        brief,
      );
      expect(result.sourceKind).toBe(kind);
      expect(result.decision).toBe("reject");
      expect(result.authority).toBe("unverified");
      expect(result.scoreMeaning).toBe("lexical_triage_only");
    }
  });

  it("preserves a user-selected source with a review reason and permits intentional corpus research", () => {
    const candidate = {
      url: "https://example.com/corpora/words.txt",
      title: "Corpus vocabulary word list",
      excerpt: "Word frequency corpus",
    };
    const explicit = assessCandidate(candidate, {
      ...brief,
      links: [candidate.url],
    });
    expect(explicit.decision).toBe("review");
    expect(explicit.reasons).toContain("user_selected_source_preserved");
    expect(
      assessCandidate(candidate, {
        question: "Compare vocabulary corpus word lists for language teaching",
      }).decision,
    ).not.toBe("reject");
    expect(
      assessCandidate({ ...candidate, url: "javascript:alert(1)" }, brief)
        .decision,
    ).toBe("reject");
  });

  it("recognizes useful identity signals for another design subject without conferring official status", () => {
    const result = assessCandidate(
      {
        url: "https://vendor.example/products/camera-bag-20l",
        title: "摄影相机包 20L 产品规格",
        excerpt: "摄影相机包防水面料与拉链，重量 900g，肩带说明书",
      },
      { question: "摄影相机包防水与拉链设计" },
    );
    expect(result.decision).toBe("keep");
    expect(result.sourceKind).toBe("product");
    expect(result.authority).toBe("unverified");
    expect(
      assessCandidate(
        {
          url: "https://vendor.example/",
          title: "官方权威研究 完全可信",
          excerpt: "所有结论均正确",
        },
        { question: "摄影相机包防水与拉链设计" },
      ).authority,
    ).toBe("unverified");
  });

  it("does not discard a structured XML manual merely because a source is XML", () => {
    const result = assessCandidate(
      {
        url: "https://vendor.example/manual.xml",
        title: "办公室电饭锅 用户手册",
        excerpt: "办公室午餐电饭锅操作参数与清洁说明",
      },
      cookingBrief,
    );
    expect(result.sourceKind).toBe("manual");
    expect(result.decision).toBe("keep");
  });
});

describe("ranked source context and truthful availability", () => {
  it("recovers the actual late Ochama body and rice-cooker passage from the captured case", () => {
    const packed = packEvidenceContext(caseEvidence, brief, {
      maxChars: 32000,
      perSourceChars: 4000,
      focus: "核对 Ochama 小米 电饭煲 电饭锅 650W 的历史参数与当前适用性",
    });
    const id = "cmve0eoyd00k73yyzjoxgl20o";
    const manifest = packed.manifest.sources.find(
      (item) => item.evidenceId === id,
    )!;
    const source = packed.sources.find((item) => item.id === id)!;
    expect(manifest.availability).toBe("captured");
    expect(manifest.capturedChars).toBeGreaterThan(99000);
    expect(manifest.includedChars).toBeGreaterThan(0);
    expect(manifest.truncated).toBe(true);
    expect(source.content).toContain("650W");
    expect(source.content).toContain("46.99欧");
    expect(source.authority).toBe("unverified");
    expect(source.sourceKind).toBe("aggregator");
    expect(packed.sources.some((item) => item.sourceKind === "corpus")).toBe(
      false,
    );
    expect(packed.usedChars).toBe(
      JSON.stringify({
        sources: packed.sources,
        diagnostics: packed.diagnostics,
      }).length,
    );
    expect(packed.usedChars).toBeLessThanOrEqual(32000);
  });

  it("makes captured, empty, failed, missing and purged bodies distinct from search snippets", () => {
    const rows: EvidenceContextRow[] = [
      captured("ev_full", "办公室电饭锅 参数", "办公室电饭锅 烹饪参数"),
      {
        id: "ev_empty",
        originalUrl: "https://b.example/manual",
        title: "办公室电饭锅 说明书",
        status: "captured",
        content: "",
      },
      {
        id: "ev_failed",
        originalUrl: "https://c.example/manual",
        title: "办公室电饭锅 说明书",
        status: "fetch_failed",
        excerpt: "搜索结果中的电饭锅操作摘要",
      },
      {
        id: "ev_link",
        originalUrl: "https://d.example/manual",
        title: "办公室电饭锅 说明书",
        status: "link_only",
        excerpt: "尚未读取的电饭锅摘要",
      },
      {
        id: "ev_missing",
        originalUrl: "https://e.example/manual",
        title: "办公室电饭锅 说明书",
        status: "captured",
      },
      {
        id: "ev_purged",
        originalUrl: "https://f.example/manual",
        title: "办公室电饭锅 说明书",
        status: "captured",
        content: "不得泄漏旧的清除材料",
        purgedAt: "2026-10-18T00:00:00Z",
      },
    ];
    const result = packEvidenceContext(rows, cookingBrief);
    const manifest = Object.fromEntries(
      result.manifest.sources.map((row) => [row.evidenceId, row]),
    );
    expect(manifest.ev_full.availability).toBe("captured");
    expect(manifest.ev_empty).toMatchObject({
      availability: "captured_empty",
      capturedChars: 0,
      omittedReason: "empty_body",
    });
    expect(manifest.ev_failed).toMatchObject({
      availability: "fetch_failed",
      capturedChars: null,
    });
    expect(manifest.ev_link).toMatchObject({
      availability: "not_fetched",
      capturedChars: null,
    });
    expect(manifest.ev_missing).toMatchObject({
      availability: "unavailable",
      capturedChars: null,
    });
    expect(manifest.ev_purged).toMatchObject({
      availability: "purged",
      capturedChars: null,
    });
    expect(result.sources.find((row) => row.id === "ev_failed")).toMatchObject({
      contentKind: "search_excerpt",
      sourceAvailability: "fetch_failed",
    });
    expect(JSON.stringify(result.sources)).not.toContain("不得泄漏");
  });

  it("accounts for serialized metadata, escapes and snippet markers within the hard character budget", () => {
    const rows = Array.from({ length: 18 }, (_, index) =>
      captured(
        `ev_${index}`,
        '办公室电饭锅 "参数"\n'.repeat(30),
        `办公室电饭锅 参数 ${index}\n\t"\\😀`.repeat(500),
        `https://example-${index}.com/products/${"long-".repeat(200)}`,
      ),
    );
    const result = packEvidenceContext(rows, cookingBrief, {
      maxChars: 4500,
      perSourceChars: 3000,
    });
    expect(result.usedChars).toBeLessThanOrEqual(4500);
    expect(result.usedChars).toBe(
      JSON.stringify({
        sources: result.sources,
        diagnostics: result.diagnostics,
      }).length,
    );
    expect(result.sources.length).toBeGreaterThan(0);
    expect(
      result.manifest.sources.some(
        (row) => row.omittedReason === "budget" && row.capturedChars! > 0,
      ),
    ).toBe(true);
    for (const source of result.sources) {
      expect(source.content).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(source.includedChars).toBe(
        source.contentRanges.reduce(
          (sum, range) => sum + range.end - range.start,
          0,
        ),
      );
    }
    expect(() =>
      packEvidenceContext(rows, cookingBrief, { maxChars: 1 }),
    ).toThrow(RangeError);
  });

  it("preserves explicitly selected noisy source content and records why it needs review", () => {
    const row = captured(
      "ev_corpus",
      "语料词频表 Corpus",
      "word list 办公室电饭锅词频",
      "https://example.com/corpus.txt",
    );
    const result = packEvidenceContext([row], {
      ...cookingBrief,
      links: [row.originalUrl!],
    });
    expect(result.sources[0].id).toBe("ev_corpus");
    expect(result.sources[0].warnings).toContain(
      "user_selected_source_preserved",
    );
    expect(result.manifest.sources[0].assessment.decision).toBe("review");
  });

  it("deduplicates actual identical body text across different URLs without equating it to independent evidence", () => {
    const rows = [
      captured("ev_a", "办公室电饭锅 参数", "办公室电饭锅 相同原始说明"),
      captured("ev_b", "办公室电饭锅 参数", "办公室电饭锅 相同原始说明"),
    ];
    const result = packEvidenceContext(rows, cookingBrief);
    expect(result.sources).toHaveLength(1);
    expect(
      result.manifest.sources.filter(
        (row) => row.omittedReason === "duplicate",
      ),
    ).toHaveLength(1);
    const quality = assessResearchQuality({
      evidence: rows,
      brief: cookingBrief,
      reportText: "[source:ev_a]",
    });
    expect(quality.metrics.relevantCapturedSources).toBe(1);
  });

  it("selects material independently of database arrival order and rejects duplicate evidence IDs", () => {
    const forward = packEvidenceContext(caseEvidence, brief, {
      maxChars: 12000,
      focus: "小米 电饭锅 650W",
    });
    const reversed = packEvidenceContext([...caseEvidence].reverse(), brief, {
      maxChars: 12000,
      focus: "小米 电饭锅 650W",
    });
    expect(reversed.sources).toEqual(forward.sources);
    expect(() =>
      packEvidenceContext([caseEvidence[0], caseEvidence[0]], brief),
    ).toThrow("Duplicate evidence id");
  });

  it("selects a late relevant passage and exposes offsets in the cleaned original text", () => {
    const body = `${"导航与不相关文字。".repeat(1000)}\n相机包防水拉链：这是需保留的独特参数 QZ-731。\n${"导航与不相关文字。".repeat(1000)}`;
    const row = captured("ev_late", "相机包 参数", body);
    const result = packEvidenceContext(
      [row],
      { question: "相机包防水拉链" },
      { focus: "独特参数 QZ-731", perSourceChars: 1000 },
    );
    expect(result.sources[0].content).toContain("QZ-731");
    expect(
      result.sources[0].contentRanges.some((range) => range.start > 0),
    ).toBe(true);
    for (const range of result.sources[0].contentRanges)
      expect(result.sources[0].content).toContain(
        body.slice(range.start, range.end),
      );
  });
});

describe("trusted user-provided attachment evidence", () => {
  it("keeps extracted user document text without counting it as an external independent source", () => {
    const row: EvidenceContextRow = {
      id: "ev_attachment",
      originalUrl: "attachment:file_document_1",
      title: "需求补充.pdf",
      status: "provided",
      excerpt: "用户提供的办公室电饭锅午餐需求与清洁约束。",
      content:
        "用户提供的办公室电饭锅午餐需求与清洁约束。需要继续调查可用产品和替代方案。",
    };
    const packed = packEvidenceContext([row], cookingBrief);
    expect(packed.sources).toHaveLength(1);
    expect(packed.sources[0]).toMatchObject({
      id: row.id,
      contentKind: "user_provided_text",
      sourceAvailability: "captured",
      authority: "unverified",
    });
    expect(packed.sources[0].warnings).toContain(
      "not_an_external_independent_source",
    );
    expect(packed.manifest.sources[0].assessment.explicitUserSource).toBe(true);
    const quality = assessResearchQuality({
      evidence: [row],
      brief: cookingBrief,
      reportText: "用户需求摘录 [source:ev_attachment]",
    });
    expect(quality.metrics).toMatchObject({
      providedTextSources: 1,
      unreadProvidedSources: 0,
      externalRelevantCapturedSources: 0,
      distinctRelevantHosts: 0,
    });
    expect(quality.status).toBe("draft");
    expect(quality.issues.map((issue) => issue.code)).not.toContain(
      "NO_SUBSTANTIVE_CAPTURED_EVIDENCE",
    );
    expect(quality.issues.map((issue) => issue.code)).toContain(
      "USER_PROVIDED_MATERIAL_ONLY",
    );
  });

  it("keeps an image-only attachment unavailable for text analysis and does not treat its placeholder as visual understanding", () => {
    const row: EvidenceContextRow = {
      id: "ev_reference_image",
      originalUrl: "attachment:file_image_1",
      title: "reference.png",
      status: "provided",
      excerpt: "用户提供的参考图，尚未进行自动视觉分析。",
    };
    const packed = packEvidenceContext([row], cookingBrief);
    expect(packed.sources).toEqual([]);
    expect(packed.manifest.sources[0]).toMatchObject({
      availability: "unavailable",
      capturedChars: null,
      includedChars: 0,
      omittedReason: "unavailable",
    });
    expect(packed.manifest.sources[0].assessment.decision).not.toBe("reject");
    const quality = assessResearchQuality({
      evidence: [row],
      brief: cookingBrief,
    });
    expect(quality.metrics).toMatchObject({
      providedTextSources: 0,
      unreadProvidedSources: 1,
      capturedSources: 0,
    });
    expect(
      quality.issues.find(
        (issue) => issue.code === "USER_ATTACHMENTS_WITHOUT_READABLE_TEXT",
      )?.message,
    ).toContain("图片留档不代表已经完成视觉分析");
  });

  it("does not promote an attachment excerpt when its retained extracted document text is missing", () => {
    const row: EvidenceContextRow = {
      id: "ev_missing_document",
      originalUrl: "attachment:file_document_2",
      title: "办公室电饭锅说明书.docx",
      status: "provided",
      excerpt:
        "办公室电饭锅参数与清洁限制：这是旧抽取片段，不是当前可读取全文。",
    };
    const packed = packEvidenceContext([row], cookingBrief);
    expect(packed.sources).toEqual([]);
    expect(packed.manifest.sources[0]).toMatchObject({
      capturedChars: null,
      includedChars: 0,
      availability: "unavailable",
      omittedReason: "unavailable",
    });
    expect(
      assessResearchQuality({ evidence: [row], brief: cookingBrief }).metrics
        .providedTextSources,
    ).toBe(0);
  });

  it("does not let ordinary search results or malformed attachment IDs bypass the HTTP URL gate", () => {
    const candidate = {
      url: "attachment:pretend_external_source",
      title: "办公室电饭锅 参数",
      excerpt: "办公室电饭锅午餐参数说明书",
    };
    expect(assessCandidate(candidate, cookingBrief).decision).toBe("reject");
    expect(
      assessCandidate(candidate, { ...cookingBrief, links: [candidate.url] })
        .decision,
    ).toBe("reject");
    const untrusted: EvidenceContextRow = {
      id: "ev_fake_attachment",
      originalUrl: candidate.url,
      title: candidate.title,
      excerpt: candidate.excerpt,
      content: candidate.excerpt,
      status: "captured",
    };
    expect(packEvidenceContext([untrusted], cookingBrief).sources).toEqual([]);
    const malformed = {
      ...untrusted,
      status: "provided",
      originalUrl: "attachment:../../arbitrary-file",
    };
    expect(packEvidenceContext([malformed], cookingBrief).sources).toEqual([]);
  });
});

describe("citation membership and evidence gates", () => {
  it("rejects unmapped positional labels while accepting explicitly allowed IDs and ignoring code examples", () => {
    const result = validateEvidenceIds(
      "已知判断 [ev_actual]，额外数字 [E1] [S1] [1] [^2]。",
      ["ev_actual"],
    );
    expect(result.valid).toBe(false);
    expect(result.unmappedCitationLabels).toEqual(["E1", "S1", "1", "2"]);
    expect(result.unknownIds).toEqual(["E1", "S1", "1", "2"]);
    expect(validateEvidenceIds("[E1] [1]", ["E1", "1"]).valid).toBe(true);
    expect(
      validateEvidenceIds(
        "示例 `values[E1]`。\n```md\n未知 [S1] [ev_missing]\n```\n实际判断 [ev_actual]",
        ["ev_actual"],
      ),
    ).toMatchObject({
      valid: true,
      referencedIds: ["ev_actual"],
      unmappedCitationLabels: [],
    });
    expect(
      validateEvidenceIds(
        "~~~md\n[1]\n~~~~\n实际判断 [ev_actual]\n\n    [S1]",
        ["ev_actual"],
      ).valid,
    ).toBe(true);
    expect(
      validateEvidenceIds("```md\n[E1]\n未结束的代码块", []).referencedIds,
    ).toEqual([]);
    expect(validateEvidenceIds("正文继续\n    未知引用 [E1]", []).valid).toBe(
      false,
    );
    expect(
      validateEvidenceIds("- 判断列表\n\n    后续论据 [E1]", []).valid,
    ).toBe(false);
    expect(validateEvidenceIds("\\` 不是代码的判断 [E1] \\`", []).valid).toBe(
      false,
    );
    expect(validateEvidenceIds("``实际代码 [E1] `值` ``", []).valid).toBe(true);
  });

  it("recognizes stable canonical IDs as citations without counting matching words in prose", () => {
    expect(
      validateEvidenceIds("A source with id foo is just being mentioned.", [
        "foo",
      ]).referencedIds,
    ).toEqual([]);
    expect(
      validateEvidenceIds("该判断来自 [foo]。", ["foo"]).referencedIds,
    ).toEqual(["foo"]);
    expect(validateEvidenceIds("句子 [E1, S2, 3]。", []).unknownIds).toEqual([
      "E1",
      "S2",
      "3",
    ]);
  });

  it("rejects the actual mixed-up CUID in verification and keeps membership separate from support", () => {
    const wrong = "cmvdzhwor00eh3yyzhtvv1efo";
    const result = validateEvidenceIds(
      `食品结论 [${wrong}]`,
      caseEvidence.map((row) => row.id),
    );
    expect(result).toMatchObject({
      valid: false,
      unknownIds: [wrong],
      scope: "id_membership_only",
    });
    expect(
      validateEvidenceIds("[source:ev_missing]", ["ev_present"]).valid,
    ).toBe(false);
    expect(validateEvidenceIds("[来源:ev_present]", ["ev_present"]).valid).toBe(
      true,
    );
    expect(
      validateEvidenceIds("[source:ev_present, ev_missing]", ["ev_present"])
        .unknownIds,
    ).toEqual(["ev_missing"]);
    expect(
      validateEvidenceIds("[原始来源](evidence:ev_missing)", ["ev_present"])
        .valid,
    ).toBe(false);
  });

  it("does not claim evidence sufficiency just because the actual task completed and files were emitted", () => {
    const result = assessResearchQuality({
      evidence: caseEvidence,
      brief,
      reportText: "研究草稿，产品事实仍缺失。",
      unresolvedQuestions: ["真实竞品型号", "清洁流程", "价格适用范围"],
      executionCompleted: true,
    });
    expect(result.executionCompleted).toBe(true);
    expect(result.status).toBe("insufficient");
    expect(result.issues.map((issue) => issue.code)).toContain(
      "NO_SUBSTANTIVE_CAPTURED_EVIDENCE",
    );
    expect(result.metrics.capturedSources).toBe(10);
    expect(result.metrics.failedSources).toBe(11);
    expect(result.metrics.linkOnlySources).toBe(34);
  });

  it("labels a passed automatic material gate as unverified, and downgrades unknown IDs or unresolved claims", () => {
    const evidence = [
      captured(
        "ev_one",
        "办公室午餐电饭锅 说明书",
        "办公室午餐电饭锅 操作说明 A",
      ),
      captured(
        "ev_two",
        "办公室午餐电饭锅 清洁评测",
        "办公室午餐电饭锅 清洁评测 B",
      ),
      captured(
        "ev_three",
        "办公室午餐电饭锅 产品规格",
        "办公室午餐电饭锅 产品规格 C",
      ),
    ];
    const input = {
      evidence,
      brief: cookingBrief,
      reportText: "[source:ev_one] [source:ev_two] [source:ev_three]",
      executionCompleted: true,
    };
    expect(assessResearchQuality(input)).toMatchObject({
      status: "supported",
      label: "自动材料门槛满足，结论仍需核验",
      assessmentScope: "material_gate_not_fact_verification",
    });
    expect(
      assessResearchQuality({ ...input, unresolvedQuestions: 1 }).status,
    ).toBe("draft");
    expect(
      assessResearchQuality({ ...input, allowedEvidenceIds: ["ev_one"] })
        .status,
    ).toBe("insufficient");
  });
});

describe("decision routing and complete passages in the recorded 105-source case", () => {
  it("does not turn a passing body mention into the main subject of a differently titled device review", () => {
    const drinking = v3Evidence.find(
      (row) => row.id === "cmve7lmxf00zl3yyz07hwhb6o",
    )!;
    const actual = assessCandidate(
      {
        url: drinking.originalUrl ?? "",
        title: drinking.title,
        excerpt: drinking.excerpt,
        content: drinking.content,
      },
      v3Brief,
    );
    expect(actual.decision).toBe("review");
    expect(actual.routing?.role).toBe("background");
    const otherCategory = assessCandidate(
      {
        url: "https://example.com/chair-review",
        title: "办公椅使用体验",
        content: "拍照时把摄影包放到桌边。此文记录椅子扶手与升降的操作。",
      },
      { question: "设计通勤摄影包与相机包" },
    );
    expect(otherCategory.decision).not.toBe("keep");
    expect(otherCategory.routing?.role).not.toBe("alternative");
  });
  const joyangId = "cmve7t3j6003p3yo8zoxvte8w";
  const officialId = "cmve7lk8x00wf3yyzt7apwo35";
  const retailId = "cmve7lka700wl3yyz7savsb8c";
  const websiteId = "cmve7llcj00xv3yyz4dzvitk3";
  const reviewed = (
    evidenceId: string,
    role: EvidenceDecisionRoute["role"],
    decisionIds = ["lunch_task"],
  ): EvidenceDecisionRoute => ({
    evidenceId,
    role,
    decisionIds,
    contentHash:
      v3Evidence.find((row) => row.id === evidenceId)?.contentHash ?? null,
    reason:
      "离线人工审核夹具：只验证分流合同；不声称模型已正确判定或来源事实已核验。",
  });

  it("keeps object-specific product/experience evidence ahead of incidental office/lunch words", () => {
    expect(v3Evidence).toHaveLength(105);
    expect(v3Evidence.filter((row) => row.content)).toHaveLength(10);
    const result = packEvidenceContext(v3Evidence, v3Brief);
    const assessment = new Map(
      result.manifest.sources.map((row) => [row.evidenceId, row.assessment]),
    );
    expect(assessment.get(officialId)?.decision).toBe("keep");
    expect(assessment.get(joyangId)?.decision).toBe("keep");
    expect(assessment.get(websiteId)?.decision).toBe("review");
    expect(assessment.get(websiteId)?.routing?.role).toBe("design_reference");
    expect(assessment.get("cmve7lkbl00wr3yyzw6vpd6jx")?.decision).not.toBe(
      "keep",
    );
    expect(result.sources.findIndex((row) => row.id === joyangId)).toBeLessThan(
      result.sources.findIndex((row) => row.id === websiteId),
    );
    for (const plan of buildSearchQueries(v3Brief))
      expect(plan.query).not.toContain("中的");
  });

  it("retains the 3+3+3 sequence, nine-minute endpoint and sponsored-sample disclosure with replayable offsets", () => {
    const result = packEvidenceContext(v3Evidence, v3Brief);
    const source = result.sources.find((row) => row.id === joyangId)!;
    expect(source.content).toContain("花了三分钟切了午餐肉块和打散鸡蛋");
    expect(source.content).toContain("三分钟后，简单美味的馅料");
    expect(source.content).toContain("前后花了9分钟左右");
    expect(source.content).toContain("本文商品由什么值得买提供");
    const original = researchSourceText(
      v3Evidence.find((row) => row.id === joyangId)!.content!,
    );
    expect(source.contentHash).toBe(
      v3Evidence.find((row) => row.id === joyangId)!.contentHash,
    );
    for (const range of source.contentRanges)
      expect(source.content).toContain(original.slice(range.start, range.end));
    expect(source.includedChars).toBe(
      source.contentRanges.reduce(
        (sum, range) => sum + range.end - range.start,
        0,
      ),
    );
    expect(result.usedChars).toBeLessThanOrEqual(32000);
    expect(source.content).not.toContain("科沃斯T80S");
  });

  it("can select complete fit, cleaning and storage observations without copying surrounding image URLs", () => {
    const result = packEvidenceContext(v3Evidence, v3Brief, {
      focus: "三明治机 食材厚度 卡扣 转轴 封边 可拆卸 清洗 竖放 收纳",
    });
    const source = result.sources.find((row) => row.id === joyangId)!;
    expect(source.content).toContain("两个卡位");
    expect(source.content).toContain("转轴要是也能抬升");
    expect(source.content).toContain("由于面包片不够大");
    expect(source.content).toContain("可拆卸式");
    expect(source.content).toContain("可以竖放");
    expect(source.content).not.toContain("pic_19/");
  });

  it("requires explicit reviewed decision roles for formal evidence and keeps background out of the sufficiency count", () => {
    const routes = [
      reviewed(officialId, "product_identity"),
      reviewed(retailId, "product_identity"),
      reviewed(joyangId, "alternative"),
      reviewed(websiteId, "design_reference", []),
      reviewed("cmve7lldl00xz3yyzjb99wd8n", "background", []),
      reviewed("cmve7lmu100yz3yyzn4lvb5cf", "irrelevant", []),
    ];
    const packed = packEvidenceContext(v3Evidence, v3Brief, {
      decisionRoutes: routes,
      requireDecisionRoutes: true,
    });
    expect(
      packed.sources.every((row) => row.routing?.method === "model_review"),
    ).toBe(true);
    expect(
      packed.sources.find((row) => row.id === "cmve7lmu100yz3yyzn4lvb5cf"),
    ).toBeUndefined();
    expect(
      packed.manifest.sources.find(
        (row) => row.evidenceId === "cmve7lkbl00wr3yyzw6vpd6jx",
      )?.omittedReason,
    ).toBe("pending_decision_route");
    const quality = assessResearchQuality({
      evidence: v3Evidence,
      brief: v3Brief,
      decisionRoutes: routes,
      requireDecisionRoutes: true,
    });
    expect(quality.metrics.relevantCapturedSources).toBe(3);
    expect(quality.assessmentScope).toBe("material_gate_not_fact_verification");
    expect(
      packEvidenceContext(v3Evidence, v3Brief, { requireDecisionRoutes: true })
        .sources,
    ).toEqual([]);
  });

  it("invalidates a route after retained content changes and rejects unknown/duplicate identities", () => {
    const oldRoute = reviewed(joyangId, "task_observation");
    const changed = v3Evidence.map((row) =>
      row.id === joyangId ? { ...row, contentHash: "a".repeat(64) } : row,
    );
    const packed = packEvidenceContext(changed, v3Brief, {
      decisionRoutes: [oldRoute],
      requireDecisionRoutes: true,
    });
    expect(packed.sources.find((row) => row.id === joyangId)).toBeUndefined();
    expect(
      packed.manifest.sources.find((row) => row.evidenceId === joyangId)
        ?.assessment.reasons,
    ).toContain("stale_decision_route");
    expect(() =>
      validateEvidenceDecisionRoutes(
        [{ ...oldRoute, evidenceId: "not_in_task" }],
        v3Evidence.map((row) => row.id),
      ),
    ).toThrow();
    expect(() =>
      validateEvidenceDecisionRoutes(
        [oldRoute, oldRoute],
        v3Evidence.map((row) => row.id),
      ),
    ).toThrow();
    expect(() =>
      validateEvidenceDecisionRoutes(
        [oldRoute],
        v3Evidence.map((row) => row.id),
        ["different_decision"],
      ),
    ).toThrow();
    expect(() =>
      validateEvidenceDecisionRoutes(
        [{ ...oldRoute, decisionIds: [] }],
        v3Evidence.map((row) => row.id),
      ),
    ).toThrow();
  });

  it("uses the same contract for chairs, camera protection and browser tools, allowing a reviewed unconventional alternative", () => {
    const chairs = { question: "设计办公室人体工学椅，比较坐姿调节和收纳" };
    const irrelevant = captured(
      "ev_lunch",
      "办公室午餐快速制作体验",
      "办公室午餐前后3分钟，工作日午餐。",
      "https://example.org/lunch",
    );
    const chair = captured(
      "ev_chair",
      "厂商官方网站",
      "人体工学椅 LC-17，座深可调节，椅背有三个角度。",
      "https://vendor.example/item/17",
    );
    expect(
      assessResearchQuality({ evidence: [irrelevant, chair], brief: chairs })
        .metrics.relevantCapturedSources,
    ).toBe(1);
    const box = captured(
      "ev_box",
      "密封午餐盒材质测试",
      "午餐盒防水但受压变形，未测试相机。",
      "https://tests.example/box",
    );
    box.contentHash = createHash("sha256").update(box.content!).digest("hex");
    const routed = packEvidenceContext(
      [box],
      { question: "相机包防雨保护的结构设计" },
      {
        requireDecisionRoutes: true,
        decisionRoutes: [
          {
            evidenceId: box.id,
            contentHash: box.contentHash,
            role: "alternative",
            decisionIds: ["protect_camera"],
            reason: "跨品类结构反例，说明密封不等于抗压；不宣称适用于相机。",
          },
        ],
      },
    );
    expect(routed.sources[0]?.routing?.role).toBe("alternative");
    const tool = assessCandidate(
      {
        url: "https://github.com/example/crawler",
        title: "Crawl4AI documentation",
        excerpt: "Crawl4AI supports website extraction.",
      },
      {
        question: "比较网页采集工具 Crawl4AI 与 Playwright",
        competitors: ["Crawl4AI", "Playwright"],
      },
    );
    expect(tool.decision).toBe("keep");
    expect(tool.authority).toBe("unverified");
  });

  it("preserves exact table and paragraph units while omitting link-only navigation", () => {
    const raw =
      "# Review\n[Home](https://example.com)\n![picture](https://example.com/a.png)\n准备食材三分钟。\n| 阶段 | 时间 |\n|---|---|\n| 合计 | 9分钟 |\nSample provided free for this review.\n";
    const blocks = researchTextBlocks(raw);
    expect(blocks.some((block) => block.kind === "disclosure")).toBe(true);
    expect(
      blocks.some(
        (block) =>
          block.kind === "table" &&
          raw.slice(block.start, block.end).includes("9分钟"),
      ),
    ).toBe(true);
    expect(blocks.some((block) => block.searchText === "Home")).toBe(false);
    expect(
      blocks.every(
        (block) => block.start < block.end && block.end <= raw.length,
      ),
    ).toBe(true);
  });

  it("keeps disclosure rows attached to table headers and never extracts a numeric fragment from an oversized table", () => {
    const table = [
      "| 设备 | 金额（人民币元） | 说明 |",
      "|---|---|---|",
      ...Array.from(
        { length: 120 },
        (_, index) =>
          `| 办公室轻食机 ${index} | 800 | ${"比较清洗流程和准备条件。".repeat(6)} |`,
      ),
      "| 赞助额度 | 9000 | 本表由测试方提供 |",
    ].join("\n");
    const blocks = researchTextBlocks(table);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("table");
    const packed = packEvidenceContext(
      [captured("large-table", "办公室轻食机成本比较", table)],
      { question: "办公室轻食机的成本与清洗比较" },
    );
    expect(packed.sources).toHaveLength(0);
    const small =
      table.split("\n").slice(0, 3).join("\n") +
      "\n| 赞助额度 | 9000 | 本表由测试方提供 |";
    const included = packEvidenceContext(
      [captured("small-table", "办公室轻食机成本比较", small)],
      { question: "办公室轻食机的成本与清洗比较" },
    );
    expect(included.sources[0].content).toContain(small);
  });

  it("does not treat user-authored related-material headings and links as web navigation", () => {
    const content =
      "# 相关文章\n办公室轻食机需要比较清洗步骤。\n# 相关产品\n办公室午餐准备时长尚未确定。\n[用户指定产品](https://example.com/product)";
    const packed = packEvidenceContext(
      [
        {
          id: "provided-notes",
          originalUrl: "attachment:provided-notes",
          title: "用户研究笔记.md",
          status: "provided",
          content,
        },
      ],
      { question: "办公室轻食机的午餐流程设计" },
    );
    expect(packed.sources).toHaveLength(1);
    expect(packed.sources[0].content).toContain("清洗步骤");
    expect(packed.sources[0].content).toContain("准备时长尚未确定");
    expect(packed.sources[0].content).toContain("[用户指定产品]");
    for (const range of packed.sources[0].contentRanges)
      expect(packed.sources[0].content).toContain(
        content.slice(range.start, range.end),
      );
  });
});

