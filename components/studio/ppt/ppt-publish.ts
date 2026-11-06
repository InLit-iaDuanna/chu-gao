import type { PptGeneration } from "../lib/types";

export const PPT_PUBLISH_MEDIA_LIMIT = 9;

export interface PptPublishMedia {
  key: string;
  imageId: string;
  preview: string;
  role: "FINAL";
  isCover: boolean;
}

export interface PptPublishPrefill {
  title: string;
  story: string;
  tags: string[];
  promptVisibility: "PRIVATE";
  media: PptPublishMedia[];
  completedMediaCount: number;
  truncated: boolean;
}

export function pptPublishHref(pptId: string): string {
  const params = new URLSearchParams({
    source: "ppt",
    pptId,
    shape: "WORK",
  });

  return `/app/publish?${params.toString()}`;
}

/**
 * Builds a deliberately small, public-safe handoff to the community composer.
 * Prompt text, reference keys, model metadata and other internal PPT fields are
 * intentionally not copied into this object.
 */
export function buildPptPublishPrefill(
  deck: PptGeneration,
): PptPublishPrefill {
  const publishableSlides = [...deck.slides]
    .sort((a, b) => a.index - b.index)
    .filter(
      (slide) =>
        slide.status === "completed" &&
        Boolean(slide.imageId) &&
        Boolean(slide.thumbnailUrl ?? slide.imageUrl),
    );
  const selectedSlides = publishableSlides.slice(0, PPT_PUBLISH_MEDIA_LIMIT);

  return {
    title: deck.title?.trim().slice(0, 120) || "PPT 演示作品",
    story: `一组共 ${deck.slides.length} 页的演示设计，公开展示其中 ${selectedSlides.length} 张已完成页面。`,
    tags: ["PPT", "演示设计"],
    promptVisibility: "PRIVATE",
    media: selectedSlides.map((slide, index) => ({
      key: `ppt:${deck.id}:${slide.imageId}`,
      imageId: slide.imageId!,
      preview: (slide.thumbnailUrl ?? slide.imageUrl)!,
      role: "FINAL",
      isCover: index === 0,
    })),
    completedMediaCount: publishableSlides.length,
    truncated: publishableSlides.length > PPT_PUBLISH_MEDIA_LIMIT,
  };
}
