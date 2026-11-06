import { describe, expect, it } from "vitest";

import type { PptGeneration } from "../lib/types";
import {
  buildPptPublishPrefill,
  PPT_PUBLISH_MEDIA_LIMIT,
  pptPublishHref,
} from "./ppt-publish";

function deckWithSlides(count: number): PptGeneration {
  return {
    id: "deck-1",
    userId: "private-user-id",
    conversationId: "private-conversation-id",
    title: "城市服务设计提案",
    fixedPrompt: "private fixed prompt",
    referenceImageKeys: ["uploads/private/reference.png"],
    status: "completed",
    progress: 100,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    slides: Array.from({ length: count }, (_, index) => ({
      id: `slide-${index}`,
      index,
      title: `第 ${index + 1} 页`,
      variablePrompt: `private variable prompt ${index}`,
      finalPrompt: `private final prompt ${index}`,
      imageId: `image-${index}`,
      imageUrl: `/api/private/image-${index}`,
      thumbnailUrl: `/api/private/thumb-${index}`,
      status: "completed" as const,
      generationId: `generation-${index}`,
      seed: 1000 + index,
    })),
  };
}

describe("PPT inspiration publishing", () => {
  it("builds a short, explicit composer URL", () => {
    expect(pptPublishHref("deck / 1")).toBe(
      "/app/publish?source=ppt&pptId=deck+%2F+1&shape=WORK",
    );
  });

  it("selects the first nine completed previews and assigns the cover", () => {
    const result = buildPptPublishPrefill(deckWithSlides(12));

    expect(result.media).toHaveLength(PPT_PUBLISH_MEDIA_LIMIT);
    expect(result.media[0]).toMatchObject({
      imageId: "image-0",
      isCover: true,
      role: "FINAL",
    });
    expect(result.media.slice(1).every((item) => !item.isCover)).toBe(true);
    expect(result.completedMediaCount).toBe(12);
    expect(result.truncated).toBe(true);
  });

  it("does not put private PPT parameters into the composer prefill", () => {
    const serialized = JSON.stringify(buildPptPublishPrefill(deckWithSlides(1)));

    expect(serialized).not.toContain("private fixed prompt");
    expect(serialized).not.toContain("private variable prompt");
    expect(serialized).not.toContain("private final prompt");
    expect(serialized).not.toContain("private-user-id");
    expect(serialized).not.toContain("private-conversation-id");
    expect(serialized).not.toContain("uploads/private/reference.png");
    expect(JSON.parse(serialized)).toMatchObject({
      title: "城市服务设计提案",
      promptVisibility: "PRIVATE",
      tags: ["PPT", "演示设计"],
    });
  });

  it("skips legacy or unfinished slides without a generated image id", () => {
    const deck = deckWithSlides(3);
    deck.slides[0]!.imageId = undefined;
    deck.slides[1]!.status = "generating";

    const result = buildPptPublishPrefill(deck);

    expect(result.media.map((item) => item.imageId)).toEqual(["image-2"]);
    expect(result.media[0]?.isCover).toBe(true);
  });
});
