import { describe, expect, it } from "vitest";
import {
  EDITORIAL_GUARD_VERSION,
  validateEditorialReport,
} from "./editorial-contract";

const primary = "cm_source_001";
const secondary = "cm_source_002";
const unused = "cm_source_003";
const allowed = [primary, secondary, unused];

describe("editorial citation lineage and numeric integrity guard", () => {
  it("allows natural prose and reordered citations while preserving the original citation set", () => {
    const draft = `价格仍未确认 [${primary}]。清洗约束已有说明 [${secondary}]。`;
    const edited = `对设计来说，当前能确定的是清洗约束 [${secondary}]。价格资料还需要继续核对 [${primary}]。`;
    const result = validateEditorialReport(edited, draft, allowed);
    expect(new Set(result.citedEvidenceIds)).toEqual(
      new Set([primary, secondary]),
    );
    expect(result.guard).toBe(EDITORIAL_GUARD_VERSION);
    expect(result.semanticClaimsVerified).toBe(false);
  });

  it("rejects dropping a draft source even if the remaining citations are valid", () => {
    expect(() =>
      validateEditorialReport(
        `只有清洗发现 [${secondary}]。`,
        `价格未知 [${primary}]。清洗限制 [${secondary}]。`,
        allowed,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_EDITORIAL_REFERENCE" }));
  });

  it.each([
    ["CUID", `c${"a".repeat(24)}`],
    ["mapped numeric identifier", unused],
    ["mapped identifier without digits", "cm_source_alpha"],
  ])(
    "rejects a new %s citation even when it exists in the supplied source package",
    (_format, addedId) => {
      expect(() =>
        validateEditorialReport(
          `原有发现 [${primary}]。新增判断 [${addedId}]。`,
          `原有发现 [${primary}]。`,
          [...allowed, addedId],
        ),
      ).toThrow(
        expect.objectContaining({ code: "INVALID_EDITORIAL_REFERENCE" }),
      );
    },
  );

  it.each(["E1", "S1", "1"])(
    "rejects an unbound %s ordinal alias instead of treating it as a source",
    (alias) => {
      expect(() =>
        validateEditorialReport(
          `发现 [${primary}]。额外结论 [${alias}]。`,
          `发现 [${primary}]。`,
          allowed,
        ),
      ).toThrow(
        expect.objectContaining({ code: "INVALID_EDITORIAL_REFERENCE" }),
      );
    },
  );

  it.each(["没有来源的草稿", "只有编号 [E1]", `未知来源 [cm_unknown_900]`])(
    "rejects a draft without valid traceable citations: %s",
    (draft) => {
      expect(() =>
        validateEditorialReport(`文本 [${primary}]。`, draft, allowed),
      ).toThrow(expect.objectContaining({ code: "INVALID_EDITORIAL_DRAFT" }));
    },
  );

  it.each([
    ["price", `价格未知 [${primary}]。`, `价格为 499 美元 [${primary}]。`],
    [
      "changed price",
      `价格为 199 美元 [${primary}]。`,
      `价格为 299 美元 [${primary}]。`,
    ],
    [
      "percentage",
      `样本比例为 20% [${primary}]。`,
      `样本比例为 30% [${primary}]。`,
    ],
    [
      "new decimal",
      `重量为 1.5 千克 [${primary}]。`,
      `重量为 1.8 千克 [${primary}]。`,
    ],
  ])("rejects a new %s numeric value", (_name, draft, report) => {
    expect(() => validateEditorialReport(report, draft, allowed)).toThrow(
      expect.objectContaining({ code: "EDITORIAL_NEW_NUMERIC_VALUE" }),
    );
  });

  it("normalizes grouping separators, decimal trailing zeros and full-width digits without changing factual values", () => {
    const draft = `价格 1000 美元；数量 1000000；占比 0.5；重量 2.25 千克 [${primary}]。`;
    const report = `价格 １,０００.００ 美元，数量 1,000,000.0，占比 0.500，重量 2.2500 千克 [${primary}]。`;
    expect(
      validateEditorialReport(report, draft, allowed).citedEvidenceIds,
    ).toEqual([primary]);
  });

  it("allows ordered-list and numbered-heading organization without inventing factual numeric values", () => {
    const draft = `清洗条件明确 [${primary}]。市场范围待核对 [${secondary}]。`;
    const report = `## 12. 当前发现\n\n1. 清洗条件明确 [${primary}]。\n2) 市场范围待核对 [${secondary}]。\n3、资料不足的地方继续保留未知。`;
    expect(
      validateEditorialReport(report, draft, allowed).citedEvidenceIds,
    ).toEqual([primary, secondary]);
  });

  it.each([
    [
      "market scope",
      `英国页面说明该产品在售 [${primary}]。`,
      `美国页面说明该产品在售 [${primary}]。`,
    ],
    [
      "certainty",
      `尚未证明美国在售 [${primary}]。`,
      `已经证明美国在售 [${primary}]。`,
    ],
    [
      "number reassignment",
      `样本为 20，价格为 100 [${primary}]。`,
      `样本为 100，价格为 20 [${primary}]。`,
    ],
  ])(
    "explicitly does not certify semantic correctness for changed %s",
    (_name, draft, report) => {
      // These edits are intentionally unsupported. This deterministic guard only
      // proves citation/numeric-set continuity; passing must never label them verified.
      const result = validateEditorialReport(report, draft, allowed);
      expect(result.semanticClaimsVerified).toBe(false);
      expect(result.guard).toBe("citation-lineage-and-numeric-literals-v1");
    },
  );
});

