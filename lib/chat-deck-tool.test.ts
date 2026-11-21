import { describe, expect, it } from "vitest";

import { agentBlocksToContextText, appendAgentBlocks } from "@/lib/chat-agent-tools";
import {
  DECK_SLIDES_MAX,
  deckBlock,
  deckBlockContextText,
  deckSlideContent,
  sanitizeDeckOutline,
} from "@/lib/chat-deck-tool";

describe("sanitizeDeckOutline", () => {
  it("cleans titles, points and visuals", () => {
    const outline = sanitizeDeckOutline(
      JSON.stringify({
        title: "  季度复盘 ",
        style: "黑白极简",
        slides: [
          { title: "封面", points: ["2026 Q3", "2026 Q3", ""] },
          { title: "", points: ["丢弃"] },
          { title: "增长", points: ["收入 +20%"], visual: "柱状图" },
        ],
      }),
    );
    expect(outline).toEqual({
      title: "季度复盘",
      style: "黑白极简",
      slides: [
        { title: "封面", points: ["2026 Q3"] },
        { title: "增长", points: ["收入 +20%"], visual: "柱状图" },
      ],
    });
  });

  it("accepts string slides and falls back to the first title", () => {
    expect(sanitizeDeckOutline({ slides: ["开场", "结尾"] })).toEqual({
      title: "开场",
      style: "",
      slides: [
        { title: "开场", points: [] },
        { title: "结尾", points: [] },
      ],
    });
  });

  it("caps the slide count and rejects empty outlines", () => {
    const many = sanitizeDeckOutline({
      slides: Array.from({ length: 30 }, (_, i) => ({ title: `第${i}页` })),
    });
    expect(many?.slides).toHaveLength(DECK_SLIDES_MAX);
    expect(sanitizeDeckOutline({ title: "空", slides: [] })).toBeNull();
    expect(sanitizeDeckOutline("not json")).toBeNull();
  });
});

describe("deck blocks", () => {
  const outline = {
    title: "产品发布",
    style: "深色",
    slides: [
      { title: "封面", points: ["副标题 `code`"] },
      { title: "功能", points: ["A", "B"], visual: "三列卡片" },
    ],
  };

  it("never closes its fence and round-trips into context text", () => {
    const block = deckBlock("deck_1", outline);
    expect(block.startsWith("```chugao-deck\n")).toBe(true);
    expect(block.slice(3, -3)).not.toContain("`");
    const context = agentBlocksToContextText(`好的。\n\n${block}`);
    expect(context).toContain("[已给出 PPT 大纲《产品发布》（id deck_1），共 2 页");
    expect(context).toContain("2. 功能：A；B（画面：三列卡片）");
    expect(context).not.toContain("chugao-deck");
  });

  it("reads a broken block as a bare marker", () => {
    expect(deckBlockContextText("{")).toBe("[已给出 PPT 大纲]");
  });

  it("puts the deck card at the end instead of ask/next", () => {
    const block = deckBlock("deck_1", outline);
    const text = appendAgentBlocks("思路如下。", {
      deck: block,
      next: ["换个风格"],
    });
    expect(text).toBe(`思路如下。\n\n${block}`);
  });

  it("writes the per-slide prompt input", () => {
    expect(deckSlideContent(outline.slides[1])).toBe(
      "标题：功能\n要点：\n- A\n- B\n画面与版式：三列卡片",
    );
  });
});
