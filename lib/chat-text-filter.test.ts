import { describe, expect, it } from "vitest";

import { ThinkingStreamFilter, stripThinkingTags } from "@/lib/chat-text-filter";

describe("thinking tag filtering", () => {
  it("removes complete thinking blocks and keeps the reply", () => {
    expect(
      stripThinkingTags("<thinking>\n我先想一想\n</thinking>好的，这就画。"),
    ).toBe("好的，这就画。");
    expect(stripThinkingTags("第一段<thinking>a</thinking>第二段")).toBe(
      "第一段第二段",
    );
    expect(stripThinkingTags("没有标记的正文")).toBe("没有标记的正文");
  });

  it("drops an unterminated thinking block instead of leaking it", () => {
    expect(stripThinkingTags("<thinking>\n被截断的思考")).toBe("");
  });

  it("filters a stream whose tags are split across chunks", () => {
    const filter = new ThinkingStreamFilter();
    const chunks = ["<thi", "nking>内心", "独白</thin", "king>结果", "在这里"];
    const text = chunks.map((chunk) => filter.push(chunk)).join("") + filter.flush();
    expect(text).toBe("结果在这里");
  });

  it("passes ordinary text through unchanged", () => {
    const filter = new ThinkingStreamFilter();
    const text = ["a < b ", "and c", " > d"].map((chunk) => filter.push(chunk)).join("");
    expect(text).toBe("a < b and c > d");
  });
});
