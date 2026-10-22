import type { Prisma } from "@prisma/client";

import { estimateCost, resolvePerImageCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  getConfiguredModel,
  listConfiguredModels,
} from "@/lib/models/runtime-config";
import type {
  Image2Mode,
  InternalRequest,
  ModelDefinition,
  PricingRule,
  Resolution,
} from "@/lib/models/types";
import { IMAGE_RESOLUTION_OPTIONS } from "@/lib/models/options";

export interface PricingSnapshot {
  modelId: string;
  ruleId: string | null;
  perImageCredits: number;
  // Keep the resolved price for each tier at submission time. This makes
  // auto-size settlement deterministic even if an admin changes pricing while
  // the job is running.
  perImageCreditsByResolution?: Partial<Record<Resolution, number>>;
  estimatedCredits: number;
  /** "api" when re-priced from the API price list; absent for web jobs. */
  channel?: "web" | "api";
  request: {
    providerChannelId?: string;
    size: string;
    image2Mode?: string;
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
  providerChannelId: string | null;
  image2Mode: string | null;
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
    providerChannelId: rule.providerChannelId,
    image2Mode:
      rule.image2Mode === "standard" || rule.image2Mode === "high"
        ? (rule.image2Mode as Image2Mode)
        : null,
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

  try {
    const rules = await db.modelPricing.findMany({
      where: { isActive: true },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    });

    return rules.map(serializeRule);
  } catch (error) {
    logger.error({ error }, "Model pricing rules read failed.");
    return [];
  }
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
  const perImageCreditsByResolution = Object.fromEntries(
    IMAGE_RESOLUTION_OPTIONS.map((resolution) => [
      resolution,
      resolvePerImageCredits(model, {
        ...request,
        resolution,
        n: 1,
      }).credits,
    ]),
  ) as Partial<Record<Resolution, number>>;

  return {
    modelId: model.id,
    ruleId: perImage.ruleId,
    perImageCredits: perImage.credits,
    perImageCreditsByResolution,
    estimatedCredits,
    request: {
      providerChannelId: request.providerChannelId,
      size: request.size,
      image2Mode: request.image2Mode,
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
  actualResolutionTiers?: Resolution[],
): number | null {
  if (!snapshot) {
    return null;
  }

  if (
    actualResolutionTiers?.length &&
    snapshot.perImageCreditsByResolution
  ) {
    const total = actualResolutionTiers.reduce(
      (sum, resolution) =>
        sum +
        (snapshot.perImageCreditsByResolution?.[resolution] ??
          snapshot.perImageCredits),
      0,
    );
    return Math.ceil(total * multiplier);
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
