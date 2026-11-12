import { createHash, randomBytes } from "node:crypto";

/**
 * New cards use 192 bits of randomness. The prefix makes them recognizable
 * without reducing the entropy of the secret itself.
 */
export function createRedemptionCode(): string {
  return `CG-${randomBytes(24).toString("hex").toUpperCase()}`;
}

export function normalizeRedemptionCode(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function hashRedemptionCode(value: string): string {
  return createHash("sha256").update(normalizeRedemptionCode(value)).digest("hex");
}
