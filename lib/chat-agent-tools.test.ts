import { describe, expect, it } from "vitest";
import {
  ASK_USER_ANTHROPIC_TOOL,
  ASK_USER_RESPONSES_TOOL,
  ASK_USER_TOOL,
  CHECK_CREDITS_RESPONSES_TOOL,
  READ_URL_RESPONSES_TOOL,
  SUGGEST_REPLIES_RESPONSES_TOOL,
  agentBlocksToContextText,
  appendAgentBlocks,
  askUserBlock,
  chatToolActivity,
  cleanToolText,
  parseToolArguments,
  repairRelayValue,
  sanitizeAskUserArgs,
  sanitizeSuggestRepliesArgs,
  suggestRepliesBlock,
} from "@/lib/chat-agent-tools";
import {
  CHAT_TOOL_MAX_REQUESTS,
  chatRequestTools,
  chatSearchAsTool,
} from "@/lib/chat-tool-set";

const ask = (value: unknown) => sanitizeAskUserArgs(JSON.stringify(value));
const suggest = (value: unknown) =>
  sanitizeSuggestRepliesArgs(JSON.stringify(value));

describe("tool definitions", () => {
  it("share one schema across the three shapes and are not strict on Responses", () => {
    expect(ASK_USER_TOOL.function.name).toBe("ask_user");
    expect(ASK_USER_RESPONSES_TOOL.name).toBe("ask_user");
    expect(ASK_USER_ANTHROPIC_TOOL.name).toBe("ask_user");
    expect(ASK_USER_RESPONSES_TOOL.parameters).toBe(
      ASK_USER_TOOL.function.parameters,
    );
    expect(ASK_USER_ANTHROPIC_TOOL.input_schema).toBe(
      ASK_USER_TOOL.function.parameters,
    );
    for (const tool of [
      ASK_USER_RESPONSES_TOOL,
      SUGGEST_REPLIES_RESPONSES_TOOL,
      READ_URL_RESPONSES_TOOL,
      CHECK_CREDITS_RESPONSES_TOOL,
    ])
      expect(tool.strict).toBe(false);
  });

  it("offers the same tools in one order on every transport", () => {
    const names = (tools: unknown[]) =>
      tools.map((tool) => {
        const value = tool as {
          name?: string;
          function?: { name: string };
        };
        return value.name ?? value.function?.name;
      });
    const base = [
      "generate_image",
      "read_url",
      "check_credits",
      "plan_presentation",
      "ask_user",
      "suggest_replies",
    ];
    expect(names(chatRequestTools("chat_completions_sse"))).toEqual(base);
    expect(names(chatRequestTools("responses_sse"))).toEqual(base);
    expect(
      names(chatRequestTools("responses_sse", { searchTool: true })),
    ).toEqual(base);
    expect(names(chatRequestTools("anthropic_messages_sse"))).toEqual(base);
    expect(
      names(chatRequestTools("anthropic_messages_sse", { searchTool: true })),
    ).toEqual(["search_web", ...base]);
    expect(chatSearchAsTool("anthropic_messages_sse", true)).toBe(true);
    expect(chatSearchAsTool("responses_sse", true)).toBe(false);
    expect(CHAT_TOOL_MAX_REQUESTS).toBe(4);
  });
});

describe("argument handling", () => {
  it("parses leniently", () => {
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments("[1]")).toEqual({});
    expect(parseToolArguments("{oops")).toEqual({});
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
  });

  it("cleans text by code point", () => {
    expect(cleanToolText("  a\u0000\n\tb  ", 10)).toBe("a b");
    expect(cleanToolText("😀😀😀", 2)).toBe("😀😀");
    expect(cleanToolText(42, 10)).toBe("");
  });

  it("builds an ask_user card with 2-4 unique, trimmed options", () => {
    expect(
      ask({
        question: " 用在哪里？ ",
        options: [
          { label: "手机", description: "竖版" },
          "电脑",
          { label: "手机" },
          { label: "" },
          { label: "打印" },
          { label: "投影" },
          { label: "第五个" },
        ],
        multiple: true,
      }),
    ).toEqual({
      kind: "card",
      card: {
        question: "用在哪里？",
        options: [
          { label: "手机", description: "竖版" },
          { label: "电脑" },
          { label: "打印" },
          { label: "投影" },
        ],
        multiple: true,
      },
    });
  });

  it("caps ask_user lengths", () => {
    const outcome = ask({
      question: "问".repeat(300),
      options: [
        { label: "甲".repeat(60), description: "说".repeat(100) },
        { label: "乙" },
      ],
    });
    expect(outcome.kind).toBe("card");
    if (outcome.kind !== "card") return;
    expect(Array.from(outcome.card.question)).toHaveLength(200);
    expect(Array.from(outcome.card.options[0].label)).toHaveLength(40);
    expect(Array.from(outcome.card.options[0].description!)).toHaveLength(80);
    expect(outcome.card.multiple).toBe(false);
  });

  it("falls back to a plain question with fewer than two options, and rejects no question", () => {
    expect(ask({ question: "横版还是竖版？", options: ["横版"] })).toEqual({
      kind: "text",
      text: "横版还是竖版？",
    });
    expect(ask({ options: ["a", "b"] })).toEqual({ kind: "invalid" });
    expect(sanitizeAskUserArgs("garbage")).toEqual({ kind: "invalid" });
  });

  it("keeps at most three short, unique suggestions", () => {
    expect(
      suggest({
        options: [
          "换成夜景",
          "换成夜景",
          "",
          "长".repeat(40),
          { label: "再来一张" },
          "第五条",
        ],
      }),
    ).toEqual(["换成夜景", "长".repeat(30), "再来一张"]);
    expect(suggest({ options: "只有一条" })).toEqual(["只有一条"]);
    expect(suggest({})).toEqual([]);
  });
});

describe("relay-leaked XML parameters", () => {
  // Captured verbatim from the botcf Opus relay on 2026-11-21.
  const leaked =
    '{"question": "这张海报是为了什么？", "options": "\\n<parameter name=\\"options\\">[\\n  {\\n    \\"label\\": \\"产品或品牌推广\\"\\n  },\\n  {\\n    \\"label\\": \\"活动/展览/演出宣传\\",\\n    \\"description\\": \\"演唱会等\\"\\n  }\\n]"}';

  it("decodes an array that arrives wrapped in a <parameter> tag", () => {
    expect(sanitizeAskUserArgs(leaked)).toEqual({
      kind: "card",
      card: {
        question: "这张海报是为了什么？",
        options: [
          { label: "产品或品牌推广" },
          { label: "活动/展览/演出宣传", description: "演唱会等" },
        ],
        multiple: false,
      },
    });
  });

  it("repairs suggest_replies the same way and leaves plain strings alone", () => {
    expect(
      sanitizeSuggestRepliesArgs(
        JSON.stringify({
          options: '<parameter name="options">["换成夜景", "再来一张竖版"]</parameter>',
        }),
      ),
    ).toEqual(["换成夜景", "再来一张竖版"]);
    expect(repairRelayValue("https://example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(repairRelayValue("[未闭合")).toBe("[未闭合");
  });
});

describe("fenced blocks", () => {
  it("writes single-line JSON that cannot close its fence", () => {
    const block = askUserBlock({
      question: "用 ``` 还是别的？",
      options: [{ label: "a" }, { label: "b", description: "d" }],
      multiple: false,
    });
    expect(block).toBe(
      '```chugao-ask\n{"question":"用 \\u0060\\u0060\\u0060 还是别的？","options":[{"label":"a"},{"label":"b","description":"d"}],"multiple":false}\n```',
    );
    expect(block.split("\n")).toHaveLength(3);
    expect(JSON.parse(block.split("\n")[1]).question).toBe("用 ``` 还是别的？");
    expect(suggestRepliesBlock(["x", "y"])).toBe(
      '```chugao-next\n{"options":["x","y"]}\n```',
    );
  });

  it("appends one block, ask_user winning over suggest_replies", () => {
    const card = {
      kind: "card" as const,
      card: { question: "q", options: [{ label: "a" }, { label: "b" }], multiple: false },
    };
    expect(appendAgentBlocks("正文\n", { ask: card, next: ["n"] })).toBe(
      `正文\n\n${askUserBlock(card.card)}`,
    );
    expect(appendAgentBlocks("正文", { next: ["n"] })).toBe(
      `正文\n\n${suggestRepliesBlock(["n"])}`,
    );
    expect(appendAgentBlocks("正文", {})).toBe("正文");
    expect(appendAgentBlocks("正文", { next: [] })).toBe("正文");
  });

  it("returns only the block when the body is empty", () => {
    expect(appendAgentBlocks("  ", { next: ["n"] })).toBe(
      suggestRepliesBlock(["n"]),
    );
  });

  it("does not repeat a plain-text question the reply already ends with", () => {
    expect(
      appendAgentBlocks("想要什么风格？", {
        ask: { kind: "text", text: "想要什么风格？" },
      }),
    ).toBe("想要什么风格？");
    expect(
      appendAgentBlocks("好的。", { ask: { kind: "text", text: "横版吗？" } }),
    ).toBe("好的。\n\n横版吗？");
  });

  it("replays stored blocks as short markers", () => {
    const text = appendAgentBlocks("先确认一下。", {
      ask: {
        kind: "card",
        card: {
          question: "用在哪里？",
          options: [{ label: "手机" }, { label: "电脑" }],
          multiple: false,
        },
      },
    });
    expect(agentBlocksToContextText(text)).toBe(
      "先确认一下。\n\n[已向用户提问：用在哪里？ 选项：手机 / 电脑]",
    );
    expect(
      agentBlocksToContextText(
        appendAgentBlocks("好了。", { next: ["换成夜景", "再来一张"] }),
      ),
    ).toBe("好了。\n\n[已给出快捷回复：换成夜景 / 再来一张]");
    expect(agentBlocksToContextText("```js\nx\n```")).toBe("```js\nx\n```");
    expect(agentBlocksToContextText("```chugao-next\nnot json\n```")).toBe(
      "[已给出快捷回复]",
    );
  });
});

describe("activity", () => {
  it.each([
    ["generate_image", "image_tool"],
    ["search_web", "searching"],
    ["read_url", "reading_url"],
    ["check_credits", "checking_credits"],
    ["ask_user", "asking"],
    ["suggest_replies", "answering"],
    ["something_else", "tool_call"],
    [undefined, "tool_call"],
  ])("maps %s to %s", (name, activity) => {
    expect(chatToolActivity(name)).toBe(activity);
  });
});
