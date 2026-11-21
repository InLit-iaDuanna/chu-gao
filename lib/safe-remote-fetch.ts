import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

/**
 * Shared SSRF guards for server-side fetches of user- or model-supplied URLs.
 *
 * - Only https, no embedded credentials.
 * - Every address the hostname resolves to must be public; the connection is
 *   then pinned to the checked address so a second DNS answer cannot point the
 *   socket somewhere else (DNS rebinding).
 * - Each redirect hop is resolved and checked again.
 *
 * storage.ts uses the address checks for provider image downloads; the chat
 * read_url tool uses fetchSafeHttps.
 */

export function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map((part) => Number(part));
  const [first, second, third] = parts;

  if (parts.length !== 4 || first === undefined || second === undefined) {
    return false;
  }

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  );
}

function mappedIpv4(normalized: string): string | null {
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) return dotted;
  // ::ffff:7f00:1 is the same IPv4-mapped address written in hex.
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function isPrivateIpv6(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = mappedIpv4(normalized);

  if (mapped) {
    return isPrivateIpv4(mapped);
  }

  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fec") ||
    normalized.startsWith("ff")
  );
}

export function isPrivateAddress(value: string): boolean {
  const version = net.isIP(value);

  if (version === 4) {
    return isPrivateIpv4(value);
  }

  if (version === 6) {
    return isPrivateIpv6(value);
  }

  return false;
}

type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** A `lookup` for http(s).request that always answers the pre-checked address. */
export function pinnedAddressLookup(address: string, family: 4 | 6) {
  return (
    _hostname: string,
    options: LookupOptions,
    callback: PinnedLookupCallback,
  ) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }

    callback(null, address, family);
  };
}

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "CREDENTIALS_NOT_ALLOWED"
  | "PORT_NOT_ALLOWED"
  | "PRIVATE_ADDRESS"
  | "DNS_FAILED"
  | "BAD_REDIRECT"
  | "TOO_MANY_REDIRECTS"
  | "HTTP_STATUS"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "TOO_LARGE"
  | "TIMEOUT"
  | "ABORTED"
  | "NETWORK";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
    readonly detail?: string | number,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export type SafeLookup = (hostname: string) => Promise<LookupAddress[]>;

const defaultLookup: SafeLookup = (hostname) =>
  dnsLookup(hostname, { all: true });

/** Parse, validate and resolve one hop. Throws SafeFetchError. */
export async function resolveSafeHttpsTarget(
  value: string | URL,
  lookup: SafeLookup = defaultLookup,
): Promise<SafeFetchTarget> {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new SafeFetchError("INVALID_URL", "invalid url");
  }
  if (url.protocol !== "https:")
    throw new SafeFetchError(
      "UNSUPPORTED_PROTOCOL",
      "only https is allowed",
      url.protocol,
    );
  if (url.username || url.password)
    throw new SafeFetchError(
      "CREDENTIALS_NOT_ALLOWED",
      "credentials are not allowed",
    );
  if (url.port && url.port !== "443")
    throw new SafeFetchError("PORT_NOT_ALLOWED", "only port 443 is allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) throw new SafeFetchError("INVALID_URL", "missing host");
  const literal = net.isIP(hostname);
  let addresses: LookupAddress[];
  if (literal) addresses = [{ address: hostname, family: literal }];
  else {
    try {
      addresses = await lookup(hostname);
    } catch {
      throw new SafeFetchError("DNS_FAILED", "host could not be resolved");
    }
  }
  if (!addresses.length)
    throw new SafeFetchError("DNS_FAILED", "host could not be resolved");
  if (addresses.some((entry) => isPrivateAddress(entry.address)))
    throw new SafeFetchError(
      "PRIVATE_ADDRESS",
      "host resolves to a private address",
    );
  const selected = addresses[0];
  return {
    url,
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
  };
}

export interface SafeResponse {
  statusCode: number;
  location: string | null;
  contentType: string;
  body: Buffer;
}

export interface SafeRequestOptions {
  headers: Record<string, string>;
  maxBytes: number;
  /** Absolute epoch-ms deadline for the whole fetch, redirects included. */
  deadline: number;
  signal?: AbortSignal;
  /** Checked on the response headers, before the body is read. */
  acceptContentType?: (mediaType: string) => boolean;
}

export type SafeRequester = (
  target: SafeFetchTarget,
  options: SafeRequestOptions,
) => Promise<SafeResponse>;

export function mediaType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function decodedStream(response: IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip")
    return response.pipe(zlib.createGunzip());
  if (encoding === "deflate") return response.pipe(zlib.createInflate());
  if (encoding === "br") return response.pipe(zlib.createBrotliDecompress());
  return response;
}

/** One pinned GET. Redirects and non-2xx statuses resolve; the caller decides. */
export const requestPinnedHttps: SafeRequester = (target, options) =>
  new Promise<SafeResponse>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: SafeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) {
        request.destroy();
        reject(error);
      } else resolve(value!);
    };
    const onAbort = () =>
      finish(new SafeFetchError("ABORTED", "request aborted"));
    const request = httpsRequest(
      target.url,
      {
        method: "GET",
        headers: options.headers,
        lookup: pinnedAddressLookup(target.address, target.family),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location =
          typeof response.headers.location === "string"
            ? response.headers.location
            : null;
        const contentType = String(response.headers["content-type"] ?? "");
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(null, {
            statusCode,
            location,
            contentType,
            body: Buffer.alloc(0),
          });
          return;
        }
        if (
          options.acceptContentType &&
          !options.acceptContentType(mediaType(contentType))
        ) {
          response.resume();
          finish(
            new SafeFetchError(
              "UNSUPPORTED_CONTENT_TYPE",
              "unsupported content type",
              mediaType(contentType) || "unknown",
            ),
          );
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          response.resume();
          finish(new SafeFetchError("TOO_LARGE", "response too large"));
          return;
        }
        let rawBytes = 0;
        response.on("data", (chunk: Buffer) => {
          rawBytes += chunk.byteLength;
          if (rawBytes > options.maxBytes)
            finish(new SafeFetchError("TOO_LARGE", "response too large"));
        });
        const stream = decodedStream(response);
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > options.maxBytes) {
            finish(new SafeFetchError("TOO_LARGE", "response too large"));
            stream.destroy();
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () =>
          finish(null, {
            statusCode,
            location,
            contentType,
            body: Buffer.concat(chunks),
          }),
        );
        stream.on("error", () =>
          finish(new SafeFetchError("NETWORK", "response stream failed")),
        );
      },
    );
    const timer = setTimeout(
      () => finish(new SafeFetchError("TIMEOUT", "request timed out")),
      Math.max(0, options.deadline - Date.now()),
    );
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    request.on("error", (error) =>
      finish(
        error instanceof SafeFetchError
          ? error
          : new SafeFetchError("NETWORK", "request failed"),
      ),
    );
    request.end();
  });

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  acceptContentType?: (mediaType: string) => boolean;
  signal?: AbortSignal;
  /** Injected for tests; defaults to DNS. */
  lookup?: SafeLookup;
  /** Injected for tests; defaults to a pinned https request. */
  request?: SafeRequester;
}

/**
 * GET an https URL with SSRF checks on every hop. Throws SafeFetchError for
 * every refusal, network failure, non-2xx status and limit.
 */
export async function fetchSafeHttps(
  value: string,
  options: SafeFetchOptions,
): Promise<{ url: URL; contentType: string; body: Buffer }> {
  const deadline = Date.now() + options.timeoutMs;
  const maxRedirects = options.maxRedirects ?? 3;
  const request = options.request ?? requestPinnedHttps;
  let current: string | URL = value;
  for (let redirects = 0; ; redirects += 1) {
    if (options.signal?.aborted)
      throw new SafeFetchError("ABORTED", "request aborted");
    if (Date.now() >= deadline)
      throw new SafeFetchError("TIMEOUT", "request timed out");
    const target = await resolveSafeHttpsTarget(current, options.lookup);
    const response = await request(target, {
      headers: options.headers ?? {},
      maxBytes: options.maxBytes,
      deadline,
      signal: options.signal,
      acceptContentType: options.acceptContentType,
    });
    if (response.statusCode >= 300 && response.statusCode < 400) {
      if (!response.location)
        throw new SafeFetchError("BAD_REDIRECT", "redirect without location");
      if (redirects >= maxRedirects)
        throw new SafeFetchError("TOO_MANY_REDIRECTS", "too many redirects");
      try {
        current = new URL(response.location, target.url);
      } catch {
        throw new SafeFetchError("BAD_REDIRECT", "invalid redirect location");
      }
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300)
      throw new SafeFetchError(
        "HTTP_STATUS",
        "unexpected status",
        response.statusCode,
      );
    if (
      options.acceptContentType &&
      !options.acceptContentType(mediaType(response.contentType))
    )
      throw new SafeFetchError(
        "UNSUPPORTED_CONTENT_TYPE",
        "unsupported content type",
        mediaType(response.contentType) || "unknown",
      );
    return {
      url: target.url,
      contentType: response.contentType,
      body: response.body,
    };
  }
}
