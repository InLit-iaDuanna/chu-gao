import { z } from "zod";

export const CREATIVE_FIELDS = [
  "goal",
  "keep",
  "change",
  "avoid",
  "style",
] as const;
export type CreativeField = (typeof CREATIVE_FIELDS)[number];
export const CREATIVE_LABELS: Record<CreativeField, string> = {
  goal: "画面目标",
  keep: "保持不变",
  change: "本次修改",
  avoid: "排除内容",
  style: "视觉风格",
};
export const CREATIVE_LIMITS: Record<CreativeField, number> = {
  goal: 800,
  keep: 700,
  change: 700,
  avoid: 700,
  style: 300,
};
export const creativeBriefSchema = z.object({
  goal: z.string().max(800),
  keep: z.string().max(700),
  change: z.string().max(700),
  avoid: z.string().max(700),
  style: z.string().max(300),
});
export type CreativeBrief = z.infer<typeof creativeBriefSchema>;
export const EMPTY_CREATIVE_BRIEF: CreativeBrief = {
  goal: "",
  keep: "",
  change: "",
  avoid: "",
  style: "",
};
export const creativeReferenceSchema = z.object({
  kind: z.enum(["upload", "source"]),
  key: z.string().min(1).max(500),
});
export const creativeDraftSchema = z.object({
  brief: creativeBriefSchema,
  locked: z.array(z.enum(CREATIVE_FIELDS)).max(5),
  baseReference: creativeReferenceSchema.nullable(),
  questions: z.array(z.string().max(200)).max(3),
  operationId: z.uuid().nullable(),
});
export type CreativeDraft = z.infer<typeof creativeDraftSchema>;
export const EMPTY_CREATIVE_DRAFT: CreativeDraft = {
  brief: EMPTY_CREATIVE_BRIEF,
  locked: [],
  baseReference: null,
  questions: [],
  operationId: null,
};
export const creativeConfirmationSchema = z.object({
  operationId: z.uuid(),
  brief: creativeBriefSchema.refine(
    (value) => Boolean(value.goal.trim()),
    "请填写画面目标",
  ),
  locked: z.array(z.enum(CREATIVE_FIELDS)).max(5),
  baseReference: creativeReferenceSchema.nullable(),
  maxCredits: z.number().int().min(0).max(1_000_000),
});
export type CreativeConfirmation = z.infer<typeof creativeConfirmationSchema>;

export function mergeCreativeBrief(
  previous: CreativeBrief,
  proposed: CreativeBrief,
  locked: readonly CreativeField[],
): CreativeBrief {
  const result = { ...proposed };
  for (const field of locked) result[field] = previous[field];
  return result;
}

export function creativePrompt(brief: CreativeBrief, hasBase: boolean): string {
  return [
    ...(hasBase ? ["以提供的基图为修改对象，不要另起一幅无关画面。"] : []),
    ...CREATIVE_FIELDS.filter((field) => brief[field].trim()).map(
      (field) => `${CREATIVE_LABELS[field]}：\n${brief[field].trim()}`,
    ),
    "保持不变与排除内容是约束；如本次修改与约束冲突，优先遵守约束。",
  ].join("\n\n");
}

export function creativeReferenceRequest(base: CreativeDraft["baseReference"]) {
  return {
    referenceImageKeys: base?.kind === "upload" ? [base.key] : [],
    sourceImageIds: base?.kind === "source" ? [base.key] : [],
  };
}
