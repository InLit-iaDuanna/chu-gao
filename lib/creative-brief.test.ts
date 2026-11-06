import { describe, expect, it } from "vitest";
import {
  CREATIVE_FIELDS,
  CREATIVE_LIMITS,
  EMPTY_CREATIVE_BRIEF,
  creativeBriefSchema,
  creativePrompt,
  creativeReferenceRequest,
  mergeCreativeBrief,
} from "./creative-brief";

describe("creative brief constraints", () => {
  it("preserves locked fields even if the model proposes conflicting values", () => {
    const current = {
      ...EMPTY_CREATIVE_BRIEF,
      keep: "保留道路坡度",
      avoid: "不要新增建筑",
    };
    const proposed = {
      ...EMPTY_CREATIVE_BRIEF,
      goal: "改造栏杆",
      keep: "改平道路",
      avoid: "新增建筑",
    };
    expect(mergeCreativeBrief(current, proposed, ["keep", "avoid"])).toEqual({
      ...proposed,
      keep: current.keep,
      avoid: current.avoid,
    });
    expect(current.keep).toBe("保留道路坡度");
  });
  it("builds a bounded prompt without dropping constraints", () => {
    const brief = creativeBriefSchema.parse(
      Object.fromEntries(
        CREATIVE_FIELDS.map((field) => [
          field,
          "字".repeat(CREATIVE_LIMITS[field]),
        ]),
      ),
    );
    const prompt = creativePrompt(brief, true);
    expect(prompt.length).toBeLessThanOrEqual(4000);
    expect(prompt).toContain("以提供的基图为修改对象");
    expect(prompt).toContain("排除内容");
  });
  it("does not silently attach an image when none was confirmed", () => {
    expect(creativeReferenceRequest(null)).toEqual({
      sourceImageIds: [],
      referenceImageKeys: [],
    });
    expect(
      creativeReferenceRequest({ kind: "source", key: "image-1" }),
    ).toEqual({ sourceImageIds: ["image-1"], referenceImageKeys: [] });
  });
});
