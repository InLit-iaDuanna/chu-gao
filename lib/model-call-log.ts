import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { CallSource } from "@/lib/model-call-types";
import {
  isRecord,
  parseModelCallContent,
  type JsonValue,
} from "@/lib/model-call-content";
import {
  classifyProviderFailure,
  ProviderRequestError,
  redactSensitiveText,
  safeUrlForDiagnostics,
} from "@/lib/providers/diagnostics";

export interface ModelCallContext {
  source?: CallSource;
  userId?: string;
  generationId?: string;
  imageId?: string;
  conversationId?: string;
  chatAttemptId?: string;
}
interface CallInput extends ModelCallContext {
  secrets?: string[];
  requestContent?: unknown;
  kind: "image" | "llm";
  operation: string;
  modelId: string;
  providerId?: string;
  providerAccountId?: string;
  providerName?: string;
  endpoint?: string;
}
const context = new AsyncLocalStorage<ModelCallContext>();
const MAX_CALL_CONTENT_LENGTH = 128_000;
export function withModelCallContext<T>(
  input: ModelCallContext,
  run: () => T,
): T {
  return context.run({ ...context.getStore(), ...input }, run);
}

// Keep credentials, signed URLs and inline image data out of durable audit logs.
export function sanitizeCallText(
  value: string,
  secrets: string[] = [],
  maxLength = 4_000,
) {
  for (const secret of secrets)
    if (secret) value = value.replaceAll(secret, "[redacted]");
  return redactSensitiveText(
    value
      .replace(/("(?:b64_json|image_base64)"\s*:\s*")[^"]*/gi, "$1[image data]")
      .replace(/data:[^\s"']+;base64,[A-Za-z0-9+/=]+/gi, "[image data]")
      .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeUrlForDiagnostics(url)),
  ).slice(0, maxLength);
}

export function sanitizeCallContent(
  value: unknown,
  secrets: string[] = [],
): string | undefined {
  if (value === undefined || value === null) return undefined;

  let content: JsonValue;
  let recovered = false;
  let truncated = false;
  if (typeof value === "string") {
    const parsed = parseModelCallContent(value);
    if (parsed.kind !== "json") {
      return (
        sanitizeCallText(value, secrets, MAX_CALL_CONTENT_LENGTH) || undefined
      );
    }
    content = parsed.value;
    recovered = parsed.recovered;
    truncated = parsed.truncated;
  } else {
    try {
      content = JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
      return sanitizeCallText(String(value), secrets, MAX_CALL_CONTENT_LENGTH);
    }
  }

  const clean = (item: JsonValue, key = ""): JsonValue => {
    if (
      /^(?:api[_-]?key|authorization|password|access[_-]?token|refresh[_-]?token|query[_-]?password|token)$/i.test(
        key,
      )
    )
      return "[redacted]";
    if (/^(?:b64_json|image_base64)$/i.test(key)) return "[image data]";
    if (typeof item === "string")
      return sanitizeCallText(item, secrets, Number.MAX_SAFE_INTEGER);
    if (Array.isArray(item)) return item.map((entry) => clean(entry));
    if (isRecord(item))
      return Object.fromEntries(
        Object.entries(item).map(([name, entry]) => [name, clean(entry, name)]),
      );
    return item;
  };
  content = clean(content);
  const limitStrings = (item: JsonValue, limit: number): JsonValue => {
    if (typeof item === "string" && item.length > limit) {
      truncated = true;
      return item.slice(0, limit) + "\n[内容过长，已截断]";
    }
    if (Array.isArray(item))
      return item.map((entry) => limitStrings(entry, limit));
    if (isRecord(item))
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [
          key,
          limitStrings(entry, limit),
        ]),
      );
    return item;
  };
  const serialize = (item: JsonValue) =>
    JSON.stringify(
      isRecord(item) && (recovered || truncated)
        ? {
            ...item,
            _log: {
              ...(isRecord(item._log) ? item._log : {}),
              recovered,
              truncated,
            },
          }
        : item,
      null,
      2,
    );
  let text = serialize(content);
  for (
    let limit = 16_000;
    text.length > MAX_CALL_CONTENT_LENGTH && limit >= 125;
    limit = Math.floor(limit / 2)
  ) {
    content = limitStrings(content, limit);
    text = serialize(content);
  }
  if (text.length > MAX_CALL_CONTENT_LENGTH) {
    return JSON.stringify({
      _log: { recovered, truncated: true },
      preview: text.slice(0, 16_000),
    });
  }
  return text;
}
export function callFailure(error: unknown, secrets: string[] = []) {
  const message = sanitizeCallText(
    error instanceof Error ? error.message : String(error),
    secrets,
  );
  const diagnostic =
    error instanceof ProviderRequestError ? error.diagnostic : undefined;
  const classification = classifyProviderFailure(error);
  let category = classification.category as string;
  if (error instanceof ZodError || error instanceof SyntaxError)
    category = "INVALID_RESPONSE";
  else if (category === "UNKNOWN" || category === "TRANSIENT_PROVIDER") {
    if (/timeout|timed out|超时|deadline/i.test(message)) category = "TIMEOUT";
    else if (/abort|cancel/i.test(message)) category = "CANCELED";
    else if (
      /fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|Invalid IP address|network/i.test(
        message,
      )
    )
      category = "NETWORK";
    else if (
      /invalid.*(output|response|content)|empty content|non-json|ZodError|JSON/i.test(
        message,
      )
    )
      category = "INVALID_RESPONSE";
  }
  return {
    errorCategory: category,
    errorMessage: message,
    ...(diagnostic
      ? {
          httpStatus: diagnostic.status,
          requestId: sanitizeCallText(diagnostic.requestId, secrets).slice(
            0,
            200,
          ),
          endpoint: sanitizeCallText(
            safeUrlForDiagnostics(diagnostic.endpoint),
            secrets,
          ),
        }
      : {}),
  };
}
function tokens(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
    ? value
    : undefined;
}

async function waitForLogWrite(write: Promise<unknown>, operation: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      write,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("log_write_timeout")), 250);
      }),
    ]);
  } catch {
    logger.warn({ operation }, "Model call log write was unavailable or slow.");
  } finally {
    clearTimeout(timer);
  }
}

export async function startModelCall(input: CallInput) {
  const {
    secrets = [],
    requestContent: initialRequestContent,
    ...fields
  } = input;
  const startedAt = new Date();
  const id = randomUUID();
  const contentInfo: {
    requestContent?: string;
    responseContent?: string;
  } = {
    requestContent: sanitizeCallContent(initialRequestContent, secrets),
  };
  let responseInfo: { httpStatus?: number; requestId?: string } = {};
  let usageInfo: {
    inputTokens?: number;
    uncachedInputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    outputTokens?: number;
  } = {};
  const creation = (async () => {
    if (!process.env.DATABASE_URL) return false;
    try {
      await db.modelCallLog.create({
        data: {
          ...context.getStore(),
          ...fields,
          id,
          source: input.source ?? context.getStore()?.source ?? "system",
          providerName: input.providerName
            ? sanitizeCallText(input.providerName, secrets).slice(0, 200)
            : undefined,
          endpoint: input.endpoint
            ? sanitizeCallText(safeUrlForDiagnostics(input.endpoint), secrets)
            : undefined,
          ...contentInfo,
          startedAt,
        },
      });
      return true;
    } catch {
      logger.warn(
        { operation: input.operation },
        "Model call log could not be started.",
      );
      return false;
    }
  })();
  await waitForLogWrite(creation, input.operation);
  return {
    response(response: Response) {
      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-openai-request-id") ??
        response.headers.get("cf-ray");
      responseInfo = {
        httpStatus: response.status,
        requestId: requestId
          ? sanitizeCallText(requestId, secrets).slice(0, 200)
          : undefined,
      };
    },
    request(content: unknown) {
      contentInfo.requestContent = sanitizeCallContent(content, secrets);
    },
    responseContent(content: unknown) {
      contentInfo.responseContent = sanitizeCallContent(content, secrets);
    },
    usage(payload: unknown) {
      if (!payload || typeof payload !== "object") return;
      const record = payload as Record<string, unknown>;
      const usage = (
        record.usage && typeof record.usage === "object" ? record.usage : record
      ) as Record<string, unknown>;
      const details = (usage.prompt_tokens_details ??
        usage.input_tokens_details) as Record<string, unknown> | undefined;
      const inputTokens = tokens(usage.input_tokens ?? usage.prompt_tokens);
      const cacheReadTokens = tokens(
        details?.cached_tokens ?? usage.cache_read_input_tokens,
      );
      const cacheCreationTokens = tokens(
        usage.cache_creation_input_tokens ??
          details?.cache_write_tokens ??
          details?.cached_creation_tokens,
      );
      const uncachedInputTokens =
        inputTokens !== undefined &&
        (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0) <= inputTokens
          ? inputTokens - (cacheReadTokens ?? 0) - (cacheCreationTokens ?? 0)
          : undefined;
      usageInfo = {
        inputTokens,
        uncachedInputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        outputTokens: tokens(usage.output_tokens ?? usage.completion_tokens),
      };
    },
    async finish(error?: unknown, extra?: { errorCategory?: string }) {
      const failure = error === undefined ? {} : callFailure(error, secrets);
      const data = {
        status: error === undefined ? "SUCCEEDED" : "FAILED",
        ...responseInfo,
        ...usageInfo,
        ...contentInfo,
        ...failure,
        ...extra,
        finishedAt: new Date(),
        durationMs: Math.min(2_147_483_647, Date.now() - startedAt.getTime()),
      };
      // Preserve ordering even when a slow create completes after the request.
      const write = creation.then(async (persisted) => {
        if (!persisted) return;
        return db.modelCallLog.update({
          where: { id },
          data,
        });
      });
      await waitForLogWrite(write, input.operation);
    },
  };
}

export async function withModelCall<T>(
  input: CallInput,
  run: (call: Awaited<ReturnType<typeof startModelCall>>) => Promise<T>,
): Promise<T> {
  const call = await startModelCall(input);
  try {
    const result = await run(call);
    call.responseContent(result);
    await call.finish();
    return result;
  } catch (error) {
    await call.finish(error);
    throw error;
  }
}
