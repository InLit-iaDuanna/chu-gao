const INTERNAL_ORIGIN = "https://chugao.internal";

function hasUnsafePathSyntax(pathname: string): boolean {
  let candidate = pathname;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (
      candidate.startsWith("//") ||
      candidate.includes("\\") ||
      /[\u0000-\u001F\u007F]/.test(candidate)
    ) {
      return true;
    }

    const decoded = decodeURIComponent(candidate);
    if (decoded === candidate) {
      return false;
    }

    candidate = decoded;
  }

  return (
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(candidate)
  );
}

/** Allow only same-origin application paths after login or registration. */
export function safeNextPath(
  value: string | string[] | undefined,
  fallback = "/app",
): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);

    if (
      parsed.origin !== INTERNAL_ORIGIN ||
      hasUnsafePathSyntax(parsed.pathname)
    ) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
