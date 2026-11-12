/**
 * Channel-level circuit breaker backed by Redis.
 *
 * When every eligible account for a model and provider channel fails with rate-limit or
 * transient errors in one generation attempt, the channel is "tripped" for a
 * short window. Subsequent requests skip the DB account query entirely and
 * throw ProviderCapacityError immediately, saving round-trips and avoiding
 * further 429s from the upstream API.
 *
 * The breaker is intentionally short-lived (default 60 s). It is NOT a
 * long-term outage detector; health.ts handles that via account health state.
 */

import { getRedis } from "@/lib/redis";

const KEY_PREFIX = "channel:circuit:";
const DEFAULT_TRIP_MS = 60_000;
const MAX_TRIP_MS = 15 * 60_000;

function circuitKey(providerChannelId: string, modelId?: string): string {
  return modelId
    ? `${KEY_PREFIX}${modelId}:${providerChannelId}`
    : `${KEY_PREFIX}${providerChannelId}`;
}

/**
 * Returns true when the channel breaker is open (i.e. skip this channel).
 * Falls back to false on any Redis error to avoid blocking real requests.
 */
export async function isChannelCircuitOpen(
  providerChannelId: string | null | undefined,
  modelId?: string,
): Promise<boolean> {
  if (!providerChannelId) return false;
  try {
    const val = await getRedis().get(circuitKey(providerChannelId, modelId));
    return val === "open";
  } catch {
    return false;
  }
}

/**
 * Trip the circuit for `durationMs`. Capped at MAX_TRIP_MS.
 * Falls back silently on Redis error.
 */
export async function tripChannelCircuit(
  providerChannelId: string | null | undefined,
  durationMs: number = DEFAULT_TRIP_MS,
  modelId?: string,
): Promise<void> {
  if (!providerChannelId) return;
  const ttl = Math.min(Math.max(durationMs, 1_000), MAX_TRIP_MS);
  try {
    await getRedis().set(
      circuitKey(providerChannelId, modelId),
      "open",
      "PX",
      ttl,
    );
  } catch {
    // Non-fatal: degrade gracefully without circuit-breaker protection
  }
}

/**
 * Reset the circuit (e.g. after a successful generation).
 * Falls back silently on Redis error.
 */
export async function resetChannelCircuit(
  providerChannelId: string | null | undefined,
  modelId?: string,
): Promise<void> {
  if (!providerChannelId) return;
  try {
    await getRedis().del(circuitKey(providerChannelId, modelId));
  } catch {
    // Non-fatal
  }
}
