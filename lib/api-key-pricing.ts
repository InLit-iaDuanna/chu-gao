/**
 * API key runtime configuration — stored in SystemConfig.
 *
 * These values tune how API-key (cgapi_...) generations are billed and
 * throttled independently from normal in-app generations.
 *
 * - creditMultiplier: estimated credits × this factor (1 = same price,
 *   1.2 = 20% premium, 0.8 = 20% discount)
 * - maxConcurrency: how many generations may run simultaneously per API key
 * - rateLimitPerMin: how many submissions a single API key may send per minute
 */
import { db } from "@/lib/db";

const KEY_MULTIPLIER = "apiKey.creditMultiplier";
const KEY_CONCURRENCY = "apiKey.maxConcurrency";
const KEY_RATE_LIMIT = "apiKey.rateLimitPerMin";

export const DEFAULT_API_KEY_MULTIPLIER = 1;
export const DEFAULT_API_KEY_CONCURRENCY = 10;
export const DEFAULT_API_KEY_RATE_LIMIT = 20;

export interface ApiKeyRuntimeConfig {
  creditMultiplier: number;
  maxConcurrency: number;
  rateLimitPerMin: number;
}

let cache: { value: ApiKeyRuntimeConfig; expiry: number } | null = null;
const CACHE_MS = 30_000;

function readNumber(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : fallback;
}

export async function getApiKeyRuntimeConfig(): Promise<ApiKeyRuntimeConfig> {
  if (cache && Date.now() < cache.expiry) return cache.value;

  let config: ApiKeyRuntimeConfig = {
    creditMultiplier: DEFAULT_API_KEY_MULTIPLIER,
    maxConcurrency: DEFAULT_API_KEY_CONCURRENCY,
    rateLimitPerMin: DEFAULT_API_KEY_RATE_LIMIT,
  };

  if (process.env.DATABASE_URL) {
    try {
      const rows = await db.systemConfig.findMany({
        where: {
          key: { in: [KEY_MULTIPLIER, KEY_CONCURRENCY, KEY_RATE_LIMIT] },
        },
      });
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      config = {
        creditMultiplier: readNumber(
          map[KEY_MULTIPLIER],
          DEFAULT_API_KEY_MULTIPLIER,
        ),
        maxConcurrency: readNumber(
          map[KEY_CONCURRENCY],
          DEFAULT_API_KEY_CONCURRENCY,
        ),
        rateLimitPerMin: readNumber(
          map[KEY_RATE_LIMIT],
          DEFAULT_API_KEY_RATE_LIMIT,
        ),
      };
    } catch {
      /* fall back to defaults */
    }
  }

  cache = { value: config, expiry: Date.now() + CACHE_MS };
  return config;
}

export async function setApiKeyRuntimeConfig(
  patch: Partial<ApiKeyRuntimeConfig>,
): Promise<ApiKeyRuntimeConfig> {
  const current = await getApiKeyRuntimeConfig();
  const next: ApiKeyRuntimeConfig = {
    creditMultiplier:
      patch.creditMultiplier !== undefined
        ? Math.max(0, Math.round(patch.creditMultiplier * 100) / 100)
        : current.creditMultiplier,
    maxConcurrency:
      patch.maxConcurrency !== undefined
        ? Math.max(1, Math.round(patch.maxConcurrency))
        : current.maxConcurrency,
    rateLimitPerMin:
      patch.rateLimitPerMin !== undefined
        ? Math.max(1, Math.round(patch.rateLimitPerMin))
        : current.rateLimitPerMin,
  };

  if (process.env.DATABASE_URL) {
    const entries: Array<[string, number]> = [
      [KEY_MULTIPLIER, next.creditMultiplier],
      [KEY_CONCURRENCY, next.maxConcurrency],
      [KEY_RATE_LIMIT, next.rateLimitPerMin],
    ];
    await Promise.all(
      entries.map(([key, value]) =>
        db.systemConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
  }

  cache = null;
  return next;
}
