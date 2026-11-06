function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function providerRequestTimeoutMs(): number {
  return positiveIntEnv("PROVIDER_REQUEST_TIMEOUT_MS", 120_000);
}

export function generationTimeoutMs(): number {
  return positiveIntEnv("GENERATION_TIMEOUT_MS", 300_000);
}

export function providerAccountMaxAttempts(): number {
  return positiveIntEnv("PROVIDER_ACCOUNT_MAX_ATTEMPTS", 5);
}
