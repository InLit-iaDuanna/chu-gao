const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(api[_-]?key["'\s:=]+)[^"',\s}]+/gi,
  /(authorization["'\s:=]+)[^"',\s}]+/gi,
  /(password["'\s:=]+)[^"',\s}]+/gi,
  /(token["'\s:=]+)[^"',\s}]+/gi,
];

export interface ProviderFailureDiagnostic {
  provider: string;
  protocol: string;
  status: number;
  statusText: string;
  endpoint: string;
  requestId: string;
  bodyPreview: string;
}

export class ProviderRequestError extends Error {
  readonly diagnostic: ProviderFailureDiagnostic;

  constructor(diagnostic: ProviderFailureDiagnostic) {
    super(
      `Provider ${diagnostic.provider} ${diagnostic.protocol} request failed: ${diagnostic.status} ${diagnostic.statusText} ` +
        `endpoint=${diagnostic.endpoint} requestId=${diagnostic.requestId} body=${diagnostic.bodyPreview}`,
    );
    this.name = "ProviderRequestError";
    this.diagnostic = diagnostic;
  }
}

export function isProviderTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.name === "HttpTimeoutError" ||
    error.message.includes("This operation was aborted") ||
    error.message.includes("AbortError") ||
    error.message.includes("请求超时") ||
    error.message.includes("超时")
  );
}

export function isUpstreamAccessForbiddenError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) {
    if (error.diagnostic.status !== 502) {
      return false;
    }

    const body = error.diagnostic.bodyPreview.toLowerCase();
    return (
      body.includes("upstream access forbidden") ||
      body.includes("upstream_error") ||
      body.includes("access forbidden") ||
      body.includes("forbidden")
    );
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = `${error.name} ${error.message}`.toLowerCase();
  return (
    message.includes("upstream access forbidden") ||
    message.includes("upstream_error") ||
    message.includes("access forbidden")
  );
}

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) =>
      current.replace(
        pattern,
        (_match, prefix: string | undefined) => `${prefix ?? ""}[redacted]`,
      ),
    value,
  );
}

export function safeUrlForDiagnostics(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";

    return url.toString().replace(/\/$/, "");
  } catch {
    return redactSensitiveText(value).replace(/[?#].*$/, "");
  }
}

export async function providerError(
  response: Response,
  providerName: string,
  protocol: string,
  endpoint: string,
): Promise<ProviderRequestError> {
  const bodyPreview = redactSensitiveText(
    (await response.text()).slice(0, 1000),
  );
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("x-openai-request-id") ??
    response.headers.get("x-goog-request-id") ??
    response.headers.get("cf-ray") ??
    "unknown";

  return new ProviderRequestError({
    provider: providerName,
    protocol,
    status: response.status,
    statusText: response.statusText,
    endpoint: safeUrlForDiagnostics(endpoint),
    requestId,
    bodyPreview,
  });
}

export function serializeProviderError(error: unknown): string {
  if (isProviderTimeoutError(error)) {
    return "渠道请求超时";
  }

  if (isUpstreamAccessForbiddenError(error)) {
    return "渠道访问被拒绝";
  }

  if (error instanceof ProviderRequestError) {
    return error.message;
  }

  if (error instanceof Error) {
    return redactSensitiveText(error.message);
  }

  return redactSensitiveText(String(error));
}
