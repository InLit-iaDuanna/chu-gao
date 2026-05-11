import type { InternalRequest, ModelDefinition } from "@/lib/models/types";

type CostRequest = Pick<InternalRequest, "n" | "resolution"> &
  Partial<
    Pick<
      InternalRequest,
      "aspectRatio" | "outputFormat" | "background" | "referenceImages"
    >
  > & {
    usesReference?: boolean;
  };

function ruleSpecificity(rule: NonNullable<ModelDefinition["pricingRules"]>[number]) {
  return [
    rule.resolution,
    rule.aspectRatio,
    rule.outputFormat,
    rule.background,
    rule.usesReference,
  ].filter((value) => value !== null && value !== undefined).length;
}

function matchesRule(
  rule: NonNullable<ModelDefinition["pricingRules"]>[number],
  req: CostRequest,
) {
  const usesReference =
    req.usesReference ?? Boolean(req.referenceImages && req.referenceImages.length > 0);

  return (
    (!rule.resolution || rule.resolution === req.resolution) &&
    (!rule.aspectRatio || rule.aspectRatio === req.aspectRatio) &&
    (!rule.outputFormat || rule.outputFormat === req.outputFormat) &&
    (!rule.background || rule.background === req.background) &&
    (rule.usesReference === null ||
      rule.usesReference === undefined ||
      rule.usesReference === usesReference)
  );
}

export function resolvePerImageCredits(
  model: ModelDefinition,
  req: CostRequest,
): { credits: number; ruleId: string | null } {
  const rule = model.pricingRules
    ?.filter((item) => matchesRule(item, req))
    .sort((a, b) => {
      const specificityDelta = ruleSpecificity(b) - ruleSpecificity(a);

      if (specificityDelta !== 0) {
        return specificityDelta;
      }

      return b.priority - a.priority;
    })[0];

  if (rule) {
    return { credits: rule.credits, ruleId: rule.id };
  }

  if (model.costAxis === "resolution") {
    return {
      credits: model.costTable[req.resolution] ?? 0,
      ruleId: null,
    };
  }

  if (model.costAxis === "flat") {
    return {
      credits: model.costTable["*"] ?? 0,
      ruleId: null,
    };
  }

  return { credits: 0, ruleId: null };
}

export function estimateCost(
  model: ModelDefinition,
  req: CostRequest,
  multiplier = 1,
): number {
  const perImage = resolvePerImageCredits(model, req).credits;

  return Math.ceil(perImage * req.n * multiplier);
}
