const REFERENCE_STYLE_PREFIX = "ppt-reference-images:v1:";

export function encodePptReferenceImageKeys(keys: string[]): string | null {
  const uniqueKeys = [
    ...new Set(keys.map((key) => key.trim()).filter(Boolean)),
  ];
  return uniqueKeys.length
    ? `${REFERENCE_STYLE_PREFIX}${JSON.stringify(uniqueKeys)}`
    : null;
}

export function decodePptReferenceImageKeys(style: string | null): string[] {
  if (!style?.startsWith(REFERENCE_STYLE_PREFIX)) return [];

  try {
    const parsed = JSON.parse(style.slice(REFERENCE_STYLE_PREFIX.length));
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}
