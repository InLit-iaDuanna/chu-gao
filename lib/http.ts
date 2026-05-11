export class HttpTimeoutError extends Error {
  constructor(message = "请求超时") {
    super(message);
    this.name = "HttpTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? 30_000,
  );
  const onAbort = () => controller.abort(init.signal?.reason);

  if (init.signal?.aborted) {
    controller.abort(init.signal.reason);
  } else {
    init.signal?.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });

    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new HttpTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onAbort);
  }
}
