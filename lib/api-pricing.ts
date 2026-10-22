/**
 * Separate price list for API-key generations.
 *
 * Admins can set an explicit per-image price for each model and resolution
 * tier. Any tier without an explicit price falls back to the web price times
 * the global API multiplier (see api-key-pricing.ts).
 *
 * The resolved API prices are written into the generation's pricing snapshot
 * at submit time, so worker settlement charges the API price — including for
 * auto-size jobs settled by the actual output tier.
 */
import { resolvePerImageCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import type { PricingSnapshot } from "@/lib/model-pricing";
import { IMAGE_RESOLUTION_OPTIONS } from "@/lib/models/options";
import type { ModelDefinition, Resolution } from "@/lib/models/types";

const KEY_PRICES = "apiKey.prices";
const CACHE_MS = 30_000;

export type ApiPriceTable = Record<string, Partial<Record<Resolution, number>>>;

let cache: { value: ApiPriceTable; expiry: number } | null = null;

const round2 = (value: number) => Math.round(value * 100) / 100;

function sanitizePriceTable(raw: unknown): ApiPriceTable {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const table: ApiPriceTable = {};
  for (const [modelId, tiers] of Object.entries(raw as Record<string, unknown>)) {
    if (!tiers || typeof tiers !== "object" || Array.isArray(tiers)) continue;
    const clean: Partial<Record<Resolution, number>> = {};
    for (const tier of IMAGE_RESOLUTION_OPTIONS) {
      const value = (tiers as Record<string, unknown>)[tier];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        clean[tier] = round2(value);
      }
    }
    if (Object.keys(clean).length > 0) table[modelId] = clean;
  }
  return table;
}

export async function getApiPriceTable(): Promise<ApiPriceTable> {
  if (cache && Date.now() < cache.expiry) return cache.value;
  let table: ApiPriceTable = {};
  if (process.env.DATABASE_URL) {
    try {
      const row = await db.systemConfig.findUnique({ where: { key: KEY_PRICES } });
      table = sanitizePriceTable(row?.value);
    } catch {
      /* fall back to no overrides */
    }
  }
  cache = { value: table, expiry: Date.now() + CACHE_MS };
  return table;
}

export async function setApiPriceTable(raw: unknown): Promise<ApiPriceTable> {
  const table = sanitizePriceTable(raw);
  if (process.env.DATABASE_URL) {
    await db.systemConfig.upsert({
      where: { key: KEY_PRICES },
      create: { key: KEY_PRICES, value: table },
      update: { value: table },
    });
  }
  cache = null;
  return table;
}

/**
 * Re-price a web pricing snapshot for an API-key request. Explicit API prices
 * win; other tiers are the web price × multiplier.
 */
export function applyApiPricing(
  snapshot: PricingSnapshot,
  overrides: Partial<Record<Resolution, number>> | undefined,
  multiplier: number,
  request: { resolution: Resolution; n: number },
): PricingSnapshot {
  const perImageCreditsByResolution = Object.fromEntries(
    IMAGE_RESOLUTION_OPTIONS.map((tier) => [
      tier,
      overrides?.[tier] ??
        round2(
          (snapshot.perImageCreditsByResolution?.[tier] ??
            snapshot.perImageCredits) * multiplier,
        ),
    ]),
  ) as Partial<Record<Resolution, number>>;
  const perImageCredits =
    overrides?.[request.resolution] ?? round2(snapshot.perImageCredits * multiplier);

  return {
    ...snapshot,
    perImageCredits,
    perImageCreditsByResolution,
    estimatedCredits: Math.ceil(perImageCredits * request.n),
    channel: "api",
  };
}

/** Per-image API price for each tier the model supports, for docs and /v1/models. */
export function resolveApiPriceList(
  model: ModelDefinition,
  overrides: Partial<Record<Resolution, number>> | undefined,
  multiplier: number,
): Partial<Record<Resolution, number>> {
  return Object.fromEntries(
    model.capabilities.resolutions.map((tier) => [
      tier,
      overrides?.[tier] ??
        round2(resolvePerImageCredits(model, { resolution: tier, n: 1 }).credits * multiplier),
    ]),
  ) as Partial<Record<Resolution, number>>;
}
