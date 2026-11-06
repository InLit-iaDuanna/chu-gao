export function parseAspect(label: string): { w: number; h: number } {
  const match = /(\d+)\s*[:x×]\s*(\d+)/i.exec(label);
  if (!match) return { w: 1, h: 1 };
  return { w: Number(match[1]), h: Number(match[2]) };
}

export function resolveStageAspect(
  image: { width?: number | null; height?: number | null } | null,
  generationAspect: string | null,
  fallbackAspect: string,
): { w: number; h: number } {
  if (image?.width && image.height) {
    return { w: image.width, h: image.height };
  }

  if (generationAspect) {
    return parseAspect(generationAspect);
  }

  return parseAspect(fallbackAspect);
}
