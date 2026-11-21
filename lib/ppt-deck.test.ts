// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findDeck: vi.fn(),
  updateDeck: vi.fn(),
  updateManyDeck: vi.fn(),
  updateSlide: vi.fn(),
  updateManySlide: vi.fn(),
  countGenerations: vi.fn(),
  findUser: vi.fn(),
  runSlide: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    pPTGeneration: {
      findUnique: mocks.findDeck,
      findFirst: mocks.findDeck,
      update: mocks.updateDeck,
      updateMany: mocks.updateManyDeck,
    },
    pPTSlide: { update: mocks.updateSlide, updateMany: mocks.updateManySlide },
    generation: { count: mocks.countGenerations },
    user: { findUnique: mocks.findUser },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/ppt-service", () => ({
  estimatePptSlideCost: vi.fn(),
  getModelWithPricing: vi.fn(),
  randomSeed: () => 1,
  runSlideGeneration: mocks.runSlide,
}));

import { advancePptDeck } from "@/lib/ppt-deck";

const slide = (index: number, status: string, extra: object = {}) => ({
  id: `s${index}`,
  index,
  status,
  generationId: null,
  generation: null,
  updatedAt: new Date(),
  ...extra,
});

function deck(slides: ReturnType<typeof slide>[]) {
  return {
    id: "deck-1",
    userId: "user-a",
    modelId: "gpt-image-2",
    theme: "deck-mode:image",
    status: "GENERATING",
    slides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateManySlide.mockResolvedValue({ count: 1 });
  mocks.updateManyDeck.mockResolvedValue({ count: 1 });
  mocks.countGenerations.mockResolvedValue(0);
  mocks.findUser.mockResolvedValue({ concurrentLimit: 10 });
  mocks.runSlide.mockResolvedValue(undefined);
});

describe("advancePptDeck", () => {
  it("renders the cover alone first", async () => {
    mocks.findDeck.mockResolvedValue(
      deck([slide(0, "PENDING"), slide(1, "PENDING"), slide(2, "PENDING")]),
    );
    await advancePptDeck("deck-1");
    expect(mocks.runSlide).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.runSlide.mock.calls[0])).toContain("s0");
  });

  it("starts the rest with the finished cover as style reference", async () => {
    const coverGeneration = {
      status: "SUCCEEDED",
      deletedAt: null,
      images: [{ storageKey: "cover.png", mimeType: "image/png" }],
    };
    mocks.findDeck.mockResolvedValue(
      deck([
        slide(0, "COMPLETED", { generationId: "g0", generation: coverGeneration }),
        slide(1, "PENDING"),
        slide(2, "PENDING"),
      ]),
    );
    mocks.findUser.mockResolvedValue({ concurrentLimit: 2 });
    mocks.countGenerations.mockResolvedValue(1);
    await advancePptDeck("deck-1");
    // Only one free slot under the user's concurrency limit.
    expect(mocks.runSlide).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        slideId: "s1",
        anchor: { key: "cover.png", mimeType: "image/png" },
        reusePrompt: true,
      }),
    );
  });

  it("closes the deck when every slide has ended", async () => {
    mocks.findDeck.mockResolvedValue(
      deck([slide(0, "COMPLETED"), slide(1, "FAILED")]),
    );
    await advancePptDeck("deck-1");
    expect(mocks.updateManyDeck).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED", progress: 50 }),
      }),
    );
    expect(mocks.runSlide).not.toHaveBeenCalled();
  });

  it("does nothing for a deck that is not rendering images", async () => {
    mocks.findDeck.mockResolvedValue({
      ...deck([slide(0, "PENDING")]),
      theme: "deck-mode:code",
    });
    await advancePptDeck("deck-1");
    expect(mocks.runSlide).not.toHaveBeenCalled();
  });
});
