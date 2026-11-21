import { describe, expect, it } from "vitest";

import { parseInteractiveBlocks } from "./chat-interactive-blocks";
import { findDeckHtml, findDeckOutline, lastHtmlBlock } from "./deck-messages";

const deck = (id: string) =>
  "```chugao-deck\n" +
  JSON.stringify({
    id,
    title: "路演",
    style: "",
    slides: [{ title: "封面", points: ["副标题"] }, { title: "问题", points: [] }],
  }) +
  "\n```";

describe("deck interactive block", () => {
  it("parses the card and strips it from the body", () => {
    const parsed = parseInteractiveBlocks(`先看大纲。\n\n${deck("d1")}`);
    expect(parsed.body.trim()).toBe("先看大纲。");
    expect(parsed.deck).toEqual({
      id: "d1",
      title: "路演",
      style: "",
      slides: [
        { title: "封面", points: ["副标题"] },
        { title: "问题", points: [] },
      ],
    });
  });

  it("drops a deck without id", () => {
    const parsed = parseInteractiveBlocks(
      '```chugao-deck\n{"slides":[{"title":"x"}]}\n```',
    );
    expect(parsed.deck).toBeUndefined();
    expect(parsed.body.trim()).toBe("");
  });
});

describe("deck messages", () => {
  const html = '<html><body><section class="slide">1</section><section class="slide">2</section></body></html>';
  const messages = [
    { role: "user", content: "做个 PPT" },
    { role: "assistant", content: deck("d1"), chatStatus: "completed" },
    { role: "user", content: "排版成可编辑幻灯片" },
    { role: "assistant", content: "```html\n" + html + "\n```", chatStatus: "completed" },
  ];

  it("finds the outline and the html written after it", () => {
    const found = findDeckOutline(messages, "d1");
    expect(found?.index).toBe(1);
    expect(findDeckHtml(messages, found!.index)).toEqual({
      source: html,
      streaming: false,
    });
    expect(findDeckOutline(messages, "other")).toBeNull();
  });

  it("stops at a newer outline", () => {
    const later = [...messages, { role: "assistant", content: deck("d2") }];
    expect(findDeckHtml(later, 1)).toBeNull();
  });

  it("reads an unclosed html fence while streaming", () => {
    expect(lastHtmlBlock("前言\n```html\n<html><section")).toBe("<html><section");
    expect(lastHtmlBlock("没有代码")).toBeNull();
  });
});
