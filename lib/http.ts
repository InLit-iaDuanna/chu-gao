export class HttpTimeoutError extends Error {
  constructor(message = "请求超时") {
    super(message);
    this.name = "HttpTimeoutError";
  }
}

export type FetchRetryOptions = {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryStatuses?: readonly number[];
};

export const PROVIDER_FETCH_RETRY: FetchRetryOptions = {
  retries: 4,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  retryStatuses: [429, 500, 502, 503, 504],
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof HttpTimeoutError || !isAbortError(error);
}

function retryAfterDelayMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");

  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return Math.max(0, timestamp - Date.now());
}

function retryDelayMs(
  response: Response | undefined,
  retry: FetchRetryOptions,
  attempt: number,
): number {
  const retryAfter = response ? retryAfterDelayMs(response) : undefined;

  if (retryAfter !== undefined) {
    return Math.min(retry.maxDelayMs, retryAfter);
  }

  const exponentialDelay = retry.baseDelayMs * 2 ** attempt;
  const jitteredDelay = exponentialDelay * (1 + Math.random() * 0.3);

  return Math.min(retry.maxDelayMs, jitteredDelay);
}

function waitWithAbort(
  ms: number,
  signal?: AbortSignal | null,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("AbortError"));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    let settled = false;
    const cleanup = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error("AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; retry?: FetchRetryOptions } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, retry, signal, ...fetchInit } = init;
  const retryStatuses = new Set(retry?.retryStatuses ?? []);
  const maxAttempts = (retry?.retries ?? 0) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);

    if (signal?.aborted) {
      controller.abort(signal.reason);
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const response = await fetch(input, {
        ...fetchInit,
        signal: controller.signal,
      });

      if (
        retry &&
        attempt < maxAttempts - 1 &&
        retryStatuses.has(response.status)
      ) {
        response.body?.cancel().catch(() => undefined);
        await waitWithAbort(retryDelayMs(response, retry, attempt), signal);
        continue;
      }

      return response;
    } catch (error) {
      const normalizedError =
        timedOut && isAbortError(error) ? new HttpTimeoutError() : error;

      if (signal?.aborted && !timedOut) {
        throw signal.reason ?? new Error("AbortError");
      }

      if (
        retry &&
        attempt < maxAttempts - 1 &&
        isRetryableNetworkError(normalizedError) &&
        !signal?.aborted
      ) {
        await waitWithAbort(
          retryDelayMs(undefined, retry, attempt),
          signal,
        );
        continue;
      }

      throw normalizedError;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  throw new Error("fetch retry attempts exhausted");
}
