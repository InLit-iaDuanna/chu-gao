import type { PublishPreloadInput } from "@/components/inspiration/publish-preload";

import type { DesignDocument, DesignObject } from "./design-types";

const DEFAULT_TITLE = "Canvas 设计";
const DEFAULT_TAG = "Canvas";

function cleanText(value: string): string {
  return value.trim().replace(/\n{3,}/g, "\n\n");
}

function textFrom(objects: DesignObject[]): string {
  return objects
    .flatMap((object) => {
      if (!object.visible || object.type !== "text") return [];
      const text = cleanText(object.text);
      return text ? [text] : [];
    })
    .join("\n\n")
    .slice(0, 10_000);
}

export function buildCanvasPublishPreload({
  document,
  selectedObjects,
  sourceKey,
  mimeType,
}: {
  document: DesignDocument;
  selectedObjects: DesignObject[];
  sourceKey: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}): PublishPreloadInput {
  const selectedText = textFrom(selectedObjects);
  const story = selectedText || textFrom(document.objects);
  const title = cleanText(document.name).slice(0, 120) || DEFAULT_TITLE;

  return {
    source: "CANVAS",
    shape: "WORK",
    discipline: "GRAPHIC",
    title,
    ...(story ? { story } : {}),
    origin: "ORIGINAL",
    sourceNote: `由站内 Canvas 画板导出（${document.width} × ${document.height}）`,
    promptVisibility: "STRUCTURE_ONLY",
    tags: [DEFAULT_TAG],
    media: [
      {
        sourceKey,
        mimeType,
        preview: `/api/upload?key=${encodeURIComponent(sourceKey)}`,
        role: "FINAL",
        isCover: true,
      },
    ],
  };
}
