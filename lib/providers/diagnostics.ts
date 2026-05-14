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

export class ProviderContentRejectedError extends Error {
  constructor(readonly providerCause?: unknown) {
    super("Provider rejected the request content.");
    this.name = "ProviderContentRejectedError";
  }
}

export class ProviderRejectedRequestError extends Error {
  constructor(readonly providerCause?: unknown) {
    super("Provider rejected the request parameters.");
    this.name = "ProviderRejectedRequestError";
  }
}

export type ProviderFailureCategory =
  | "CONTENT_REJECTED"
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "TRANSIENT_PROVIDER"
  | "AUTH_ACCOUNT_FATAL"
  | "UNKNOWN";

export interface ProviderFailureClassification {
  category: ProviderFailureCategory;
  status?: number;
}

const CONTENT_REJECTION_PATTERNS = [
  /content[_\s-]?policy/i,
  /policy[_\s-]?violation/i,
  /safety/i,
  /moderation/i,
  /content[_\s-]?filter/i,
  /blocked\s+prompt/i,
  /input\s+rejected/i,
  /unsafe/i,
  /\bviolence\b/i,
  /\bviolent\b/i,
  /\bgore\b/i,
  /\bgory\b/i,
  /graphic\s+violence/i,
  /dismember/i,
  /decapitat/i,
  /behead/i,
  /mutilat/i,
  /torture/i,
  /blood\s+and\s+gore/i,
  /内容安全/,
  /安全策略/,
  /不允许的内容/,
  /提示词.*违规/,
  /输入.*违规/,
  /审核.*拒绝/,
  /血腥/,
  /暴力/,
];

const BAD_REQUEST_PATTERNS = [
  /bad\s+request/i,
  /invalid[_\s-]?request/i,
  /invalid\s+(prompt|parameter|value|image|size|input)/i,
  /unsupported\s+(parameter|value|image|size|input)/i,
  /schema\s+validation/i,
];

function providerErrorText(error: unknown): string {
  if (error instanceof ProviderRequestError) {
    return `${error.diagnostic.statusText} ${error.diagnostic.bodyPreview}`;
  }

  if (error instanceof Error) {
    return `${error.name} ${error.message}`;
  }

  return String(error);
}

function statusFromSerializedMessage(message: string): number | undefined {
  const match =
    message.match(/request failed:\s*(\d{3})/i) ??
    message.match(/Provider error:\s*(\d{3})/i);

  if (!match?.[1]) {
    return undefined;
  }

  const status = Number(match[1]);

  return Number.isFinite(status) ? status : undefined;
}

function hasContentRejectionSignal(text: string): boolean {
  return CONTENT_REJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBadRequestSignal(text: string): boolean {
  return BAD_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyProviderFailure(
  error: unknown,
): ProviderFailureClassification {
  if (error instanceof ProviderContentRejectedError) {
    return { category: "CONTENT_REJECTED" };
  }

  if (error instanceof ProviderRejectedRequestError) {
    return { category: "BAD_REQUEST" };
  }

  if (isProviderTimeoutError(error)) {
    return { category: "TRANSIENT_PROVIDER" };
  }

  if (isUpstreamAccessForbiddenError(error)) {
    return { category: "AUTH_ACCOUNT_FATAL", status: 502 };
  }

  const text = providerErrorText(error);

  if (error instanceof ProviderRequestError) {
    const { status } = error.diagnostic;

    if (status === 429) {
      return { category: "RATE_LIMITED", status };
    }

    if (
      (status === 400 || status === 403 || status === 422) &&
      hasContentRejectionSignal(text)
    ) {
      return { category: "CONTENT_REJECTED", status };
    }

    if (status === 400 || status === 422) {
      return { category: "BAD_REQUEST", status };
    }

    if (status >= 500) {
      return { category: "TRANSIENT_PROVIDER", status };
    }

    if (status === 401 || status === 403 || status === 404) {
      return { category: "AUTH_ACCOUNT_FATAL", status };
    }

    return { category: "UNKNOWN", status };
  }

  if (hasContentRejectionSignal(text)) {
    return { category: "CONTENT_REJECTED" };
  }

  const status = statusFromSerializedMessage(text);

  if (status === 429) {
    return { category: "RATE_LIMITED", status };
  }

  if (status === 400 || status === 422 || hasBadRequestSignal(text)) {
    return { category: "BAD_REQUEST", status };
  }

  if (status && status >= 500) {
    return { category: "TRANSIENT_PROVIDER", status };
  }

  if (status === 401 || status === 403 || status === 404) {
    return { category: "AUTH_ACCOUNT_FATAL", status };
  }

  return { category: "UNKNOWN", status };
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
  if (error instanceof ProviderContentRejectedError) {
    return serializeProviderError(error.providerCause ?? error.message);
  }

  if (error instanceof ProviderRejectedRequestError) {
    return serializeProviderError(error.providerCause ?? error.message);
  }

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
