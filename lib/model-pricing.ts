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
import { channelIdFromProvider } from "@/lib/provider-channels";
import {
  isFallbackProvider,
  providerCostMultiplier,
} from "@/lib/providers/account-pool";
import {
  providerChannelMatchesBaseUrl,
  supportedModelIds,
} from "@/lib/providers/availability";
import { modelProtocolToProviderProtocol } from "@/lib/providers/protocols";

export interface SnapshotPrices {
  ruleId: string | null;
  perImageCredits: number;
  // Keep the resolved price for each tier at submission time. This makes
  // auto-size settlement deterministic even if an admin changes pricing while
  // the job is running.
  perImageCreditsByResolution?: Partial<Record<Resolution, number>>;
}

export interface PricingSnapshot extends SnapshotPrices {
  modelId: string;
  providerChannelPrices?: Record<string, SnapshotPrices>;
  providerMultipliers?: Record<string, number>;
  selectedProvider?: SnapshotPrices & {
    providerId: string;
    providerAccountId: string | null;
    providerChannelId: string;
    multiplier: number;
    reservedCredits: number;
  };
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
  const pricesForChannel = (providerChannelId?: string): SnapshotPrices => {
    const channelRequest = { ...request, providerChannelId };
    const perImage = resolvePerImageCredits(model, channelRequest);
    return {
      ruleId: perImage.ruleId,
      perImageCredits: perImage.credits,
      perImageCreditsByResolution: Object.fromEntries(
        IMAGE_RESOLUTION_OPTIONS.map((resolution) => [
          resolution,
          resolvePerImageCredits(model, {
            ...channelRequest,
            // An auto quote is an estimate, not the returned image's tier.
            size: request.size === "auto" ? undefined : request.size,
            resolution,
            n: 1,
          }).credits,
        ]),
      ),
    };
  };
  const channelIds = [
    ...new Set(
      model.pricingRules?.flatMap((rule) =>
        rule.providerChannelId ? [rule.providerChannelId] : [],
      ) ?? [],
    ),
  ];

  return {
    ...pricesForChannel(request.providerChannelId),
    modelId: model.id,
    providerChannelPrices: Object.fromEntries(
      channelIds.map((channelId) => [channelId, pricesForChannel(channelId)]),
    ),
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

export async function snapshotProviderMultipliers(
  snapshot: PricingSnapshot,
  request: InternalRequest,
  client: Pick<Prisma.TransactionClient, "provider"> = db,
): Promise<PricingSnapshot> {
  const providers = await client.provider.findMany({
    where: {
      isActive: true,
      protocol: modelProtocolToProviderProtocol(request.protocol),
      OR: supportedModelIds(request.modelId).map((id) => ({
        modelsSupported: { has: id },
      })),
    },
    select: { id: true, costMultiplier: true },
  });
  return {
    ...snapshot,
    providerMultipliers: Object.fromEntries(
      providers.map((provider) => [
        provider.id,
        providerCostMultiplier(provider),
      ]),
    ),
  };
}

export function pricingSnapshotForProvider(
  snapshot: PricingSnapshot,
  selection: {
    providerId: string;
    providerAccountId: string | null;
    baseUrl: string;
  },
  request: InternalRequest,
): PricingSnapshot {
  const provider = { id: selection.providerId };
  const frozenMultiplier = snapshot.providerMultipliers?.[provider.id];
  if (
    (isFallbackProvider(provider) || snapshot.providerMultipliers) &&
    !(
      typeof frozenMultiplier === "number" &&
      Number.isFinite(frozenMultiplier) &&
      frozenMultiplier > 0
    )
  ) {
    throw new Error("Provider pricing was not frozen at submission");
  }
  const multiplier = frozenMultiplier ?? 1;
  if (
    isFallbackProvider(provider) &&
    request.size === "auto" &&
    !snapshot.perImageCreditsByResolution
  ) {
    throw new Error("Provider resolution pricing was not frozen at submission");
  }
  const providerChannelId = channelIdFromProvider(
    provider.id,
    selection.baseUrl,
  );
  const channelPrices = snapshot.providerChannelPrices ?? {};
  const matchingChannel = Object.keys(channelPrices).filter((channelId) =>
    providerChannelMatchesBaseUrl(channelId, selection.baseUrl, provider.id),
  );
  const selectedChannel = [
    providerChannelId,
    request.providerChannelId,
    ...matchingChannel,
  ].find((channelId) => channelId && matchingChannel.includes(channelId));
  const prices = selectedChannel ? channelPrices[selectedChannel] : snapshot;
  const count = request.executionPolicy === "single-submit" ? 1 : request.n;
  const maxPerImage =
    isFallbackProvider(provider) && request.size === "auto"
      ? Math.max(
          prices.perImageCredits,
          ...Object.values(prices.perImageCreditsByResolution ?? {}),
        )
      : prices.perImageCredits;
  const requiredCredits = Math.ceil(maxPerImage * count * multiplier);
  const reservedCredits =
    request.executionPolicy === "single-submit" && !isFallbackProvider(provider)
      ? Math.min(requiredCredits, snapshot.estimatedCredits)
      : requiredCredits;

  return {
    ...snapshot,
    selectedProvider: {
      ruleId: prices.ruleId,
      perImageCredits: prices.perImageCredits,
      ...(prices.perImageCreditsByResolution
        ? { perImageCreditsByResolution: prices.perImageCreditsByResolution }
        : {}),
      providerId: provider.id,
      providerAccountId: selection.providerAccountId,
      providerChannelId,
      multiplier,
      reservedCredits,
    },
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

  const prices = snapshot.selectedProvider ?? snapshot;
  const effectiveMultiplier =
    multiplier * (snapshot.selectedProvider?.multiplier ?? 1);

  if (actualResolutionTiers?.length && prices.perImageCreditsByResolution) {
    const total = actualResolutionTiers.reduce(
      (sum, resolution) =>
        sum +
        (prices.perImageCreditsByResolution?.[resolution] ??
          prices.perImageCredits),
      0,
    );
    return Math.ceil(total * effectiveMultiplier);
  }

  return Math.ceil(prices.perImageCredits * count * effectiveMultiplier);
}

export function parsePricingSnapshot(value: unknown): PricingSnapshot | null {
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
