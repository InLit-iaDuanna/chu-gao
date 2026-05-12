const IPV4_PARTS = 4;
const IPV6_PARTS = 8;

function isValidIpv4Candidate(value: string): boolean {
  const parts = value.split(".");

  if (parts.length !== IPV4_PARTS) {
    return false;
  }

  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function stripIpPort(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    return trimmed.slice(1, trimmed.indexOf("]"));
  }

  if (
    trimmed.includes(":") &&
    trimmed.includes(".") &&
    trimmed.lastIndexOf(":") > trimmed.lastIndexOf(".")
  ) {
    return trimmed.slice(0, trimmed.lastIndexOf(":"));
  }

  if (
    trimmed.split(":").length === 2 &&
    isValidIpv4Candidate(trimmed.split(":")[0] ?? "")
  ) {
    return trimmed.split(":")[0] ?? "";
  }

  return trimmed;
}

function expandIpv6(value: string): string[] | null {
  const [head, tail] = value.split("::");

  if (value.split("::").length > 2) {
    return null;
  }

  const left = head
    ? head.split(":").filter((part) => part.length > 0)
    : [];
  const right = tail
    ? tail.split(":").filter((part) => part.length > 0)
    : [];

  const maybeIpv4 = right[right.length - 1] ?? left[left.length - 1];

  if (maybeIpv4?.includes(".")) {
    if (!isValidIpv4Candidate(maybeIpv4)) {
      return null;
    }

    const ipv4Parts = maybeIpv4.split(".").map((part) => Number(part));
    const hi = ((ipv4Parts[0] ?? 0) << 8) + (ipv4Parts[1] ?? 0);
    const lo = ((ipv4Parts[2] ?? 0) << 8) + (ipv4Parts[3] ?? 0);
    const replacement = [hi.toString(16), lo.toString(16)];

    if (right[right.length - 1] === maybeIpv4) {
      right.splice(right.length - 1, 1, ...replacement);
    } else {
      left.splice(left.length - 1, 1, ...replacement);
    }
  }

  const missing = IPV6_PARTS - (left.length + right.length);

  if ((!value.includes("::") && missing !== 0) || missing < 0) {
    return null;
  }

  return [...left, ...Array.from({ length: missing }, () => "0"), ...right];
}

function detectIpVersion(value: string): 4 | 6 | 0 {
  if (isValidIpv4Candidate(value)) {
    return 4;
  }

  if (!value.includes(":")) {
    return 0;
  }

  return expandIpv6(value) ? 6 : 0;
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const raw = stripIpPort(value).replace(/^::ffff:/i, "");
  const version = detectIpVersion(raw);

  if (version === 4) {
    return raw;
  }

  if (version === 6) {
    return expandIpv6(raw)?.map((part) => part.padStart(4, "0").toLowerCase()).join(":") ?? null;
  }

  return null;
}

function parseIpv4ToNumber(value: string): number {
  return value
    .split(".")
    .map((part) => Number(part))
    .reduce((result, segment) => result * 256 + segment, 0);
}

function parseAllowlistEntry(entry: string):
  | { kind: "exact"; value: string }
  | { kind: "cidr4"; network: number; mask: number }
  | null {
  const trimmed = entry.trim();

  if (!trimmed) {
    return null;
  }

  const [ipPart, prefixPart] = trimmed.split("/");
  const normalizedIp = normalizeIp(ipPart ?? "");

  if (!normalizedIp) {
    return null;
  }

  if (prefixPart === undefined) {
    return {
      kind: "exact",
      value: normalizedIp,
    };
  }

  if (detectIpVersion(normalizedIp) !== 4) {
    return null;
  }

  const prefix = Number(prefixPart);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = parseIpv4ToNumber(normalizedIp) & mask;

  return {
    kind: "cidr4",
    network,
    mask,
  };
}

export function getClientIp(headers: Headers): string | null {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((part) => part.trim())
      .find(Boolean) ?? null,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function parseAdminIpAllowlist(value = process.env.ADMIN_IP_ALLOWLIST ?? "") {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isIpAllowed(ip: string | null, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }

  const normalizedIp = normalizeIp(ip);

  if (!normalizedIp) {
    return false;
  }

  const version = detectIpVersion(normalizedIp);
  const ipv4Number = version === 4 ? parseIpv4ToNumber(normalizedIp) : null;

  return allowlist.some((entry) => {
    const parsed = parseAllowlistEntry(entry);

    if (!parsed) {
      return false;
    }

    if (parsed.kind === "exact") {
      return parsed.value === normalizedIp;
    }

    return ipv4Number !== null && (ipv4Number & parsed.mask) === parsed.network;
  });
}

export function isAdminIpAllowed(headers: Headers): boolean {
  return isIpAllowed(getClientIp(headers), parseAdminIpAllowlist());
}
