import { describe, expect, it } from "vitest";
import {
  joinAskAnswer,
  parseInteractiveBlocks,
  selectedAskOptions,
  stripInteractiveBlocks,
} from "./chat-interactive-blocks";

const ask = {
  question: "这张图打算用在哪里？",
  options: [
    { label: "小红书封面", description: "3:4 竖版" },
    { label: "电商主图" },
    { label: "头像" },
  ],
  multiple: false,
};
const fence = (language: string, value: unknown) =>
  "```" +
  language +
  "\n" +
  (typeof value === "string" ? value : JSON.stringify(value)) +
  "\n```";

describe("parseInteractiveBlocks", () => {
  it("leaves ordinary content untouched", () => {
    const content = "普通回复\n\n```js\nconst a = 1;\n```\n";
    expect(parseInteractiveBlocks(content)).toEqual({
      body: content,
      incomplete: false,
    });
    expect(parseInteractiveBlocks(content, { streaming: true }).body).toBe(
      content,
    );
  });

  it("extracts a valid ask and next block and removes them from the body", () => {
    const content = `先确认一下用途。\n\n${fence("chugao-ask", ask)}\n\n${fence(
      "chugao-next",
      { options: ["换成夜景", "改成竖版海报", "再来 4 张"] },
    )}\n`;
    const result = parseInteractiveBlocks(content);
    expect(result.body).toBe("先确认一下用途。");
    expect(result.ask).toEqual(ask);
    expect(result.next).toEqual({
      options: ["换成夜景", "改成竖版海报", "再来 4 张"],
    });
    expect(result.incomplete).toBe(false);
    expect(stripInteractiveBlocks(content)).toBe("先确认一下用途。");
  });

  it("parses multiple choice and defaults missing multiple to single choice", () => {
    expect(
      parseInteractiveBlocks(fence("chugao-ask", { ...ask, multiple: true }))
        .ask?.multiple,
    ).toBe(true);
    const { multiple: _omit, ...single } = ask;
    void _omit;
    expect(
      parseInteractiveBlocks(fence("chugao-ask", single)).ask?.multiple,
    ).toBe(false);
  });

  it.each([
    ["invalid JSON", "{question: 1"],
    ["not an object", "[1,2]"],
    ["empty question", { ...ask, question: "  " }],
    ["question too long", { ...ask, question: "问".repeat(201) }],
    ["one option", { ...ask, options: [{ label: "a" }] }],
    [
      "five options",
      { ...ask, options: ["a", "b", "c", "d", "e"].map((label) => ({ label })) },
    ],
    ["missing label", { ...ask, options: [{ label: "a" }, { description: "b" }] }],
    ["label too long", { ...ask, options: [{ label: "长".repeat(41) }, { label: "b" }] }],
    [
      "description too long",
      { ...ask, options: [{ label: "a", description: "长".repeat(81) }, { label: "b" }] },
    ],
    ["non-boolean multiple", { ...ask, multiple: "yes" }],
  ])("drops an ask block with %s without leaking its source", (_name, value) => {
    const result = parseInteractiveBlocks(`说明\n\n${fence("chugao-ask", value)}`);
    expect(result.ask).toBeUndefined();
    expect(result.body).toBe("说明");
  });

  it.each([
    ["no options", { options: [] }],
    ["four options", { options: ["a", "b", "c", "d"] }],
    ["option too long", { options: ["长".repeat(31)] }],
    ["non-string option", { options: ["a", 2] }],
    ["invalid JSON", "{options:"],
  ])("drops a next block with %s", (_name, value) => {
    const result = parseInteractiveBlocks(`说明\n\n${fence("chugao-next", value)}`);
    expect(result.next).toBeUndefined();
    expect(result.body).toBe("说明");
  });

  it("accepts limits measured in characters, not UTF-16 units", () => {
    const result = parseInteractiveBlocks(
      fence("chugao-next", { options: ["𠮷".repeat(30)] }),
    );
    expect(result.next?.options).toEqual(["𠮷".repeat(30)]);
  });

  it("hides an unclosed fence while streaming and in truncated previews", () => {
    const partialJson = '说明文字\n\n```chugao-ask\n{"question":"这张图打算';
    expect(parseInteractiveBlocks(partialJson, { streaming: true })).toEqual({
      body: "说明文字",
      incomplete: true,
    });
    expect(stripInteractiveBlocks(partialJson)).toBe("说明文字");
    expect(
      parseInteractiveBlocks("说明文字\n\n```chugao-next", { streaming: true })
        .body,
    ).toBe("说明文字");
  });

  it("hides a partially typed language tag only while streaming", () => {
    expect(
      parseInteractiveBlocks("说明文字\n\n```chug", { streaming: true }).body,
    ).toBe("说明文字");
    expect(
      parseInteractiveBlocks("说明文字\n\n```js", { streaming: true }).body,
    ).toBe("说明文字\n\n```js");
    expect(
      parseInteractiveBlocks("说明\n\n```js\nconst a = 1;\n```", {
        streaming: true,
      }).body,
    ).toBe("说明\n\n```js\nconst a = 1;\n```");
  });

  it("returns an empty body when the reply is only an interactive block", () => {
    const result = parseInteractiveBlocks(fence("chugao-ask", ask));
    expect(result.body).toBe("");
    expect(result.ask?.options).toHaveLength(3);
  });
});

describe("ask answers", () => {
  it("matches a single label and joined multiple labels", () => {
    expect([...selectedAskOptions(ask, " 电商主图 ")]).toEqual(["电商主图"]);
    expect(selectedAskOptions(ask, "电商主图、头像").size).toBe(0);
    const multi = { ...ask, multiple: true };
    expect([...selectedAskOptions(multi, "电商主图、头像")]).toEqual([
      "电商主图",
      "头像",
    ]);
    expect(selectedAskOptions(multi, "电商主图、其他").size).toBe(0);
    expect(selectedAskOptions(multi, undefined).size).toBe(0);
  });

  it("joins selected labels in option order", () => {
    expect(joinAskAnswer(ask, ["头像", "小红书封面"])).toBe("小红书封面、头像");
  });
});
