// 把 Prisma 的 PPTGeneration 行映射成前端视图模型。
// 这是 API ↔ 组件契约的唯一收敛点。
// 每页的图片/状态优先取自关联的 Generation（标准生成队列产物），
// 兜底用 PPTSlide 自身存的快照字段。

import type {
  Prisma,
  PPTGenerationStatus,
  PPTSlideStatus,
} from "@prisma/client";
import type {
  PPTGeneration,
  PPTGenerationStatusView,
  PPTSlide,
  PPTSlideStatusView,
} from "@/lib/ppt-generator";
import { decodePptReferenceImageKeys } from "@/lib/ppt-reference";
import { privateImageThumbnailUrl, privateImageUrl } from "@/lib/storage";

// 查询时需 include slides + 每个 slide 关联的 generation.images。
export type PrismaPPTGenerationWithSlides = Prisma.PPTGenerationGetPayload<{
  include: {
    slides: {
      include: {
        generation: {
          include: { images: true };
        };
      };
    };
  };
}>;

type PrismaPPTSlide = PrismaPPTGenerationWithSlides["slides"][number];

const GENERATION_STATUS_MAP: Record<
  PPTGenerationStatus,
  PPTGenerationStatusView
> = {
  PREPARING: "preparing",
  ENHANCING: "enhancing",
  GENERATING: "generating",
  COMPLETED: "completed",
  FAILED: "failed",
};

const SLIDE_STATUS_MAP: Record<PPTSlideStatus, PPTSlideStatusView> = {
  PENDING: "pending",
  ENHANCING: "enhancing",
  GENERATING: "generating",
  COMPLETED: "completed",
  FAILED: "failed",
};

// 由关联 Generation 的状态推导该页展示状态（优先于 slide 自身的快照状态）。
function deriveSlideStatus(slide: PrismaPPTSlide): PPTSlideStatusView {
  const generation = slide.generation;

  if (!generation) {
    return SLIDE_STATUS_MAP[slide.status];
  }

  if (generation.deletedAt) return "failed";

  switch (generation.status) {
    case "SUCCEEDED":
      return "completed";
    case "FAILED":
    case "CANCELED":
      return "failed";
    case "RUNNING":
      return "generating";
    case "PENDING":
      return "generating";
    default:
      return SLIDE_STATUS_MAP[slide.status];
  }
}

function serializePPTSlide(slide: PrismaPPTSlide): PPTSlide {
  const generation = slide.generation;
  const generationExpired = Boolean(generation?.deletedAt);
  const firstImage = !generationExpired && generation?.images
    ? [...generation.images].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )[0]
    : undefined;

  const imageUrl = generationExpired
    ? null
    : firstImage
    ? privateImageUrl(generation!.id, firstImage.id)
    : slide.imageUrl;
  const thumbnailUrl = generationExpired
    ? null
    : firstImage
    ? firstImage.thumbnailKey
      ? privateImageThumbnailUrl(generation!.id, firstImage.id)
      : privateImageUrl(generation!.id, firstImage.id)
    : (slide.thumbnailUrl ?? slide.imageUrl);

  return {
    id: slide.id,
    index: slide.index,
    title: slide.title ?? undefined,
    variablePrompt: slide.originalContent,
    finalPrompt: slide.enhancedPrompt,
    imageUrl: imageUrl ?? null,
    thumbnailUrl: thumbnailUrl ?? null,
    imageId: generationExpired ? undefined : firstImage?.id,
    status: deriveSlideStatus(slide),
    error: generationExpired
      ? "原始生成图片已超过 30 天保留期，不能再发布"
      : slide.error ?? generation?.errorMessage ?? undefined,
    generationId: slide.generationId ?? undefined,
    seed: slide.seed ?? undefined,
  };
}

export function serializePPTGeneration(
  record: PrismaPPTGenerationWithSlides,
): PPTGeneration {
  const slides = [...record.slides]
    .sort((a, b) => a.index - b.index)
    .map(serializePPTSlide);

  const completed = slides.filter((s) => s.status === "completed").length;
  const progress = slides.length
    ? Math.round((completed / slides.length) * 100)
    : record.progress;

  return {
    id: record.id,
    userId: record.userId,
    conversationId: record.conversationId ?? undefined,
    title: record.title ?? record.theme ?? undefined,
    fixedPrompt: record.fixedPrompt ?? "",
    referenceImageKeys: decodePptReferenceImageKeys(record.style),
    status: GENERATION_STATUS_MAP[record.status],
    progress,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    slides,
  };
}
