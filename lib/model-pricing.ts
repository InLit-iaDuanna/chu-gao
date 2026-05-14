import type { Prisma } from "@prisma/client";

import { estimateCost, resolvePerImageCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import {
  getConfiguredModel,
  listConfiguredModels,
} from "@/lib/models/runtime-config";
import type {
  InternalRequest,
  ModelDefinition,
  PricingRule,
} from "@/lib/models/types";

export interface PricingSnapshot {
  modelId: string;
  ruleId: string | null;
  perImageCredits: number;
  estimatedCredits: number;
  request: {
    resolution: string;
    aspectRatio: string;
    outputFormat: string;
    background: string;
    usesReference: boolean;
  };
  createdAt: string;
}

function serializeRule(rule: {
  id: string;
  modelId: string;
  resolution: string | null;
  aspectRatio: string | null;
  outputFormat: string | null;
  background: string | null;
  usesReference: boolean | null;
  credits: number;
  priority: number;
}): PricingRule {
  return {
    id: rule.id,
    modelId: rule.modelId,
    resolution: rule.resolution,
    aspectRatio: rule.aspectRatio,
    outputFormat: rule.outputFormat,
    background: rule.background,
    usesReference: rule.usesReference,
    credits: rule.credits,
    priority: rule.priority,
  };
}

export async function listModelPricingRules(): Promise<PricingRule[]> {
  if (!process.env.DATABASE_URL) {
    return [];
  }

  const rules = await db.modelPricing.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });

  return rules.map(serializeRule);
}

export async function listModelsWithPricing(): Promise<ModelDefinition[]> {
  const rules = await listModelPricingRules();
  const models = await listConfiguredModels();

  return models.map((model) => ({
    ...model,
    pricingRules: rules.filter((rule) => rule.modelId === model.id),
  }));
}

export async function getModelWithPricing(
  modelId: string,
): Promise<ModelDefinition | null> {
  const model = await getConfiguredModel(modelId);

  if (!model) {
    return null;
  }

  const rules = await listModelPricingRules();

  return {
    ...model,
    pricingRules: rules.filter((rule) => rule.modelId === model.id),
  };
}

export function createPricingSnapshot(
  model: ModelDefinition,
  request: InternalRequest,
  estimatedCredits = estimateCost(model, request),
): PricingSnapshot {
  const perImage = resolvePerImageCredits(model, request);

  return {
    modelId: model.id,
    ruleId: perImage.ruleId,
    perImageCredits: perImage.credits,
    estimatedCredits,
    request: {
      resolution: request.resolution,
      aspectRatio: request.aspectRatio,
      outputFormat: request.outputFormat,
      background: request.background,
      usesReference: Boolean(request.referenceImages?.length),
    },
    createdAt: new Date().toISOString(),
  };
}

export function estimateCostFromSnapshot(
  snapshot: PricingSnapshot | null | undefined,
  count: number,
  multiplier = 1,
): number | null {
  if (!snapshot) {
    return null;
  }

  return Math.ceil(snapshot.perImageCredits * count * multiplier);
}

export function parsePricingSnapshot(
  value: Prisma.JsonValue | null | undefined,
): PricingSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Partial<PricingSnapshot>;

  if (
    typeof snapshot.modelId !== "string" ||
    typeof snapshot.perImageCredits !== "number" ||
    typeof snapshot.estimatedCredits !== "number"
  ) {
    return null;
  }

  return snapshot as PricingSnapshot;
}
