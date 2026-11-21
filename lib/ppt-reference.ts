const REFERENCE_STYLE_PREFIX = "ppt-reference-images:v1:";

// How a chat deck is made, stored in the legacy PPTGeneration.theme column:
// null = outline waiting for the user; see lib/ppt-deck.ts.
export type DeckMode = "image" | "code";
const DECK_MODE_PREFIX = "deck-mode:";

export function encodeDeckMode(mode: DeckMode): string {
  return `${DECK_MODE_PREFIX}${mode}`;
}

export function decodeDeckMode(
  theme: string | null | undefined,
): DeckMode | null {
  if (theme === encodeDeckMode("image")) return "image";
  if (theme === encodeDeckMode("code")) return "code";
  return null;
}

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
