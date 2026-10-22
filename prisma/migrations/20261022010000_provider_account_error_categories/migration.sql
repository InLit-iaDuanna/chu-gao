-- Add per-category error counters to ProviderAccount.
-- These allow health.ts to distinguish rate-limit errors (recoverable) from
-- transient provider errors, enabling smarter account scoring and circuit-breaker
-- decisions without touching the existing consecutiveErrors field.

ALTER TABLE "ProviderAccount"
  ADD COLUMN "rateLimitErrors"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transientErrors"  INTEGER NOT NULL DEFAULT 0;
