// 对话里的演示文稿：大纲草稿 → 用户选择制作方式 → 服务端编排。
//
// 「整页设计图」由服务端推进，不依赖浏览器开着：先出封面，封面完成后把它作为
// 风格参考图交给其余页；每次只占用户剩余的并发名额，名额满时该页回到等待，
// 由生图 worker 在任务结束时（以及定时巡检）再次推进。
// 「可编辑幻灯片」由对话模型按大纲写 HTML，这里只记录选择。
//
// 制作方式记在 PPTGeneration.theme（旧版遗留的可空字段），避免为此加迁移：
//   null = 大纲待确认；"deck-mode:image" / "deck-mode:code" = 已选择。

import type { Prisma } from "@prisma/client";

import {
  deckSlideContent,
  type DeckOutline,
} from "@/lib/chat-deck-tool";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { InternalReferenceImage } from "@/lib/models/types";
import {
  estimatePptSlideCost,
  getModelWithPricing,
  randomSeed,
  runSlideGeneration,
} from "@/lib/ppt-service";
import { ConcurrentLimitError } from "@/lib/rate-limit";

import {
  decodeDeckMode,
  encodeDeckMode,
  type DeckMode,
} from "@/lib/ppt-reference";

export { decodeDeckMode, encodeDeckMode, type DeckMode };

const DEFAULT_DECK_MODEL = "gpt-image-2";
/** At most this many slides of one deck render at the same time. */
const DECK_PARALLEL_MAX = 4;
/** A claimed slide that never reached the queue (crash) is retried after this. */
const STALE_CLAIM_MS = 5 * 60_000;

export class DeckError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DeckError";
  }
}

/** The user's image model when it can render 16:9 slides, otherwise the default. */
async function resolveDeckModelId(preferred?: string | null) {
  for (const id of [preferred, DEFAULT_DECK_MODEL]) {
    if (!id) continue;
    const model = await getModelWithPricing(id).catch(() => null);
    if (!model) continue;
    try {
      estimatePptSlideCost(model);
      return id;
    } catch {
      // This model cannot take the slide size; try the next one.
    }
  }
  return DEFAULT_DECK_MODEL;
}

function slidePromptContent(
  outline: DeckOutline,
  index: number,
): string {
  const slide = outline.slides[index];
  const total = outline.slides.length;
  const role =
    index === 0 ? "封面" : index === total - 1 && total > 2 ? "结尾页" : "内容页";
  return [
    `演示文稿《${outline.title}》第 ${index + 1}/${total} 页（${role}），16:9 横版整页设计。`,
    deckSlideContent(slide),
    "画面里要清晰排版出上面的标题和要点文字，照抄原文，不增删、不改写，不出现页码以外的多余文字。",
  ].join("\n");
}

/** Store a plan_presentation outline as a draft deck of this conversation. */
export async function createDeckDraft(input: {
  userId: string;
  conversationId: string;
  imageModelId?: string | null;
  outline: DeckOutline;
}): Promise<{ id: string }> {
  const modelId = await resolveDeckModelId(input.imageModelId);
  const created = await db.pPTGeneration.create({
    data: {
      userId: input.userId,
      conversationId: input.conversationId,
      title: input.outline.title,
      modelId,
      fixedPrompt: input.outline.style,
      status: "PREPARING",
      progress: 0,
      slides: {
        create: input.outline.slides.map((slide, index) => ({
          index,
          type: index === 0 ? "title" : "content",
          title: slide.title,
          originalContent: slidePromptContent(input.outline, index),
          enhancedPrompt: "",
          status: "PENDING",
          seed: randomSeed(),
        })),
      },
    },
    select: { id: true },
  });
  return created;
}

/** Estimated credits of one slide in image mode, or null when unknown. */
export async function estimateDeckSlideCredits(
  modelId: string | null | undefined,
): Promise<number | null> {
  if (!modelId) return null;
  const model = await getModelWithPricing(modelId).catch(() => null);
  if (!model) return null;
  try {
    return estimatePptSlideCost(model);
  } catch {
    return null;
  }
}

/** The user picked how the outlined deck is made. */
export async function startDeckRender(input: {
  userId: string;
  deckId: string;
  mode: DeckMode;
}): Promise<void> {
  const deck = await db.pPTGeneration.findFirst({
    where: { id: input.deckId, userId: input.userId },
    include: { slides: { select: { id: true } } },
  });
  if (!deck) throw new DeckError("演示文稿不存在", "NOT_FOUND", 404);
  const current = decodeDeckMode(deck.theme);
  if (current) {
    if (current === input.mode) {
      if (current === "image") kickDeck(deck.id);
      return;
    }
    throw new DeckError("这份大纲已经开始制作了", "DECK_ALREADY_STARTED", 409);
  }

  if (input.mode === "code") {
    await db.pPTGeneration.update({
      where: { id: deck.id },
      data: { theme: encodeDeckMode("code"), status: "COMPLETED" },
    });
    return;
  }

  const slideCredits = await estimateDeckSlideCredits(deck.modelId);
  if (slideCredits === null)
    throw new DeckError("出图模型暂不可用", "MODEL_NOT_AVAILABLE");
  const total = slideCredits * deck.slides.length;
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { credits: true },
  });
  if (!user || user.credits < total)
    throw new DeckError(
      `积分不足：整套约需 ${total} 积分，当前余额 ${user?.credits ?? 0}`,
      "INSUFFICIENT_CREDITS",
      402,
    );
  const claimed = await db.pPTGeneration.updateMany({
    where: { id: deck.id, theme: null },
    data: { theme: encodeDeckMode("image"), status: "GENERATING" },
  });
  if (!claimed.count)
    throw new DeckError("这份大纲已经开始制作了", "DECK_ALREADY_STARTED", 409);
  // The cover's prompt optimisation takes seconds; answer the click first.
  kickDeck(deck.id);
}

function kickDeck(deckId: string) {
  void advancePptDeck(deckId).catch((error) =>
    logger.warn({ deckId, error }, "Deck advance failed."),
  );
}

const DECK_INCLUDE = {
  slides: {
    orderBy: { index: "asc" as const },
    include: {
      generation: {
        select: {
          status: true,
          deletedAt: true,
          images: {
            orderBy: { createdAt: "asc" as const },
            take: 1,
            select: { storageKey: true, mimeType: true },
          },
        },
      },
    },
  },
} satisfies Prisma.PPTGenerationInclude;

type DeckRecord = Prisma.PPTGenerationGetPayload<{
  include: typeof DECK_INCLUDE;
}>;
type DeckSlideRecord = DeckRecord["slides"][number];

/** The slide status implied by its linked generation (the source of truth). */
function syncedStatus(slide: DeckSlideRecord): DeckSlideRecord["status"] {
  const generation = slide.generation;
  if (!generation) return slide.status;
  if (generation.deletedAt) return "FAILED";
  switch (generation.status) {
    case "SUCCEEDED":
      return generation.images.length ? "COMPLETED" : "FAILED";
    case "FAILED":
    case "CANCELED":
      return "FAILED";
    default:
      return "GENERATING";
  }
}

function slideAnchor(slide: DeckSlideRecord | undefined) {
  const image = slide?.generation?.images[0];
  return image
    ? ({ key: image.storageKey, mimeType: image.mimeType } satisfies InternalReferenceImage)
    : undefined;
}

/**
 * Move an image-mode deck forward: sync slide states from their generations,
 * start what the user's concurrency allows (cover first), and close the deck
 * when nothing is left. Safe to call repeatedly and concurrently: a slide is
 * claimed with a conditional update before it is submitted.
 */
export async function advancePptDeck(deckId: string): Promise<void> {
  const deck = await db.pPTGeneration.findUnique({
    where: { id: deckId },
    include: DECK_INCLUDE,
  });
  if (!deck || decodeDeckMode(deck.theme) !== "image") return;
  if (deck.status !== "GENERATING") return;

  const now = Date.now();
  const slides = deck.slides;
  for (const slide of slides) {
    // A slide that already has its generation follows it; one that was
    // claimed and then lost (process crash) goes back to waiting.
    const synced =
      slide.status === "ENHANCING" &&
      !slide.generation &&
      now - slide.updatedAt.getTime() > STALE_CLAIM_MS
        ? "PENDING"
        : slide.status === "ENHANCING"
          ? "ENHANCING"
          : syncedStatus(slide);
    if (synced !== slide.status) {
      await db.pPTSlide.updateMany({
        where: { id: slide.id, status: slide.status },
        data: { status: synced },
      });
      slide.status = synced;
    }
  }

  const active = slides.filter(
    (slide) => slide.status === "ENHANCING" || slide.status === "GENERATING",
  );
  const pending = slides.filter((slide) => slide.status === "PENDING");
  const completed = slides.filter((slide) => slide.status === "COMPLETED");

  if (!active.length && !pending.length) {
    await db.pPTGeneration.updateMany({
      where: { id: deck.id, status: "GENERATING" },
      data: {
        status: completed.length ? "COMPLETED" : "FAILED",
        progress: Math.round((completed.length / Math.max(1, slides.length)) * 100),
      },
    });
    return;
  }
  await db.pPTGeneration.update({
    where: { id: deck.id },
    data: {
      progress: Math.round((completed.length / Math.max(1, slides.length)) * 100),
    },
  });
  if (!pending.length) return;

  const cover = slides[0];
  let queue: DeckSlideRecord[];
  if (cover.status === "PENDING") queue = [cover];
  else if (cover.status === "ENHANCING" || cover.status === "GENERATING")
    return; // The rest waits for the cover, their style reference.
  else queue = pending;

  const user = await db.user.findUnique({
    where: { id: deck.userId },
    select: { concurrentLimit: true },
  });
  const running = await db.generation.count({
    where: { userId: deck.userId, status: { in: ["PENDING", "RUNNING"] } },
  });
  const slots = Math.min(
    (user?.concurrentLimit ?? 1) - running,
    DECK_PARALLEL_MAX - active.length,
  );
  if (slots <= 0) return;

  const anchor = cover.status === "COMPLETED" ? slideAnchor(cover) : undefined;
  for (const slide of queue.slice(0, slots)) {
    const claimed = await db.pPTSlide.updateMany({
      where: { id: slide.id, status: "PENDING" },
      data: { status: "ENHANCING" },
    });
    if (!claimed.count) continue;
    try {
      await runSlideGeneration({
        userId: deck.userId,
        pptGenerationId: deck.id,
        slideId: slide.id,
        anchor: slide.id === cover.id ? undefined : anchor,
        reusePrompt: true,
      });
    } catch (error) {
      if (error instanceof ConcurrentLimitError) return;
      const message =
        error instanceof Error ? error.message.slice(0, 300) : "幻灯片生成失败";
      await db.pPTSlide.updateMany({
        where: { id: slide.id, status: { in: ["ENHANCING", "PENDING"] } },
        data: { status: "FAILED", error: message },
      });
      logger.warn({ deckId, slideId: slide.id, error }, "Deck slide submission failed.");
      // A cover that cannot be submitted must not stall the deck.
      if (slide.id === cover.id) return advancePptDeck(deckId);
    }
  }
}

/** The cover image of a chat deck, as the style reference for redoing another slide. */
export async function deckAnchorFor(
  deckId: string,
  slideId: string,
): Promise<InternalReferenceImage | undefined> {
  const deck = await db.pPTGeneration.findUnique({
    where: { id: deckId },
    include: DECK_INCLUDE,
  });
  if (!deck || decodeDeckMode(deck.theme) !== "image") return undefined;
  const cover = deck.slides[0];
  if (!cover || cover.id === slideId || syncedStatus(cover) !== "COMPLETED")
    return undefined;
  return slideAnchor(cover);
}

/** Called by the generation worker when a job ends. */
export async function advanceDeckForGeneration(generationId: string) {
  const slide = await db.pPTSlide.findFirst({
    where: { generationId },
    select: { pptGenerationId: true },
  });
  if (slide) await advancePptDeck(slide.pptGenerationId);
}

/** Periodic safety net for decks whose wake-up was lost. */
export async function sweepActiveDecks() {
  const decks = await db.pPTGeneration.findMany({
    where: {
      status: "GENERATING",
      theme: encodeDeckMode("image"),
      updatedAt: { gte: new Date(Date.now() - 2 * 24 * 3600_000) },
    },
    select: { id: true },
    take: 50,
  });
  for (const deck of decks) {
    await advancePptDeck(deck.id).catch((error) =>
      logger.warn({ deckId: deck.id, error }, "Deck sweep failed."),
    );
  }
}
