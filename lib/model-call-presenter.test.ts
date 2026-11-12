import { describe, expect, it } from "vitest";

import {
  modelCallFieldLabel,
  modelCallRoleLabel,
  parseModelCallContent,
} from "./model-call-presenter";

describe("model call presenter", () => {
  it("识别并保留结构化 JSON", () => {
    const result = parseModelCallContent(
      JSON.stringify({
        model: "opus-5-5",
        messages: [{ role: "user", content: "你好" }],
      }),
    );

    expect(result.kind).toBe("json");
    if (result.kind !== "json") return;
    expect(result.value).toMatchObject({ model: "opus-5-5" });
  });

  it("识别 SSE 并拆出事件", () => {
    const result = parseModelCallContent(
      [
        "event: response.output_text.delta",
        'data: {"type":"response.output_text.delta","delta":"你好"}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
    );

    expect(result.kind).toBe("sse");
    if (result.kind !== "sse") return;
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0].event).toBe("response.output_text.delta");
    expect(result.frames[1].done).toBe(true);
  });

  it("普通文本不误判为 JSON", () => {
    const result = parseModelCallContent("模型返回的普通文本");
    expect(result).toMatchObject({ kind: "text", value: "模型返回的普通文本" });
  });

  it("提供可读的字段和角色名称", () => {
    expect(modelCallFieldLabel("response_format")).toBe("返回格式");
    expect(modelCallRoleLabel("assistant")).toBe("助手");
    expect(modelCallRoleLabel("custom_role")).toBe("custom_role");
  });

  it("recovers old log envelopes whose escaped HTML quotes were removed", () => {
    const text =
      '```html\n<!doctype html><html lang="zh-CN"><head><style>body{font-family:"PingFang SC", sans-serif}</style></head><body><div title="a, b">作品</div></body></html>\n```\n\n**说明**：完成';
    const raw = JSON.stringify({ text, error: null }, null, 2).replace(
      /\\([/"'])/g,
      "$1",
    );
    const result = parseModelCallContent(raw);
    expect(result).toMatchObject({
      kind: "json",
      recovered: true,
      truncated: false,
      value: { text, error: null },
    });
  });

  it("recovers truncated pretty-printed request messages and marks missing context", () => {
    const request = {
      model: "test",
      messages: [
        { role: "system", content: "保留用户要求" },
        {
          role: "user",
          content:
            '```html\n<div title="a, b">' +
            "画面".repeat(20_000) +
            "</div>\n```",
        },
      ],
    };
    const raw = JSON.stringify(request, null, 2)
      .replace(/\\([/"'])/g, "$1")
      .slice(0, 24_000);
    expect(parseModelCallContent(raw)).toMatchObject({
      kind: "json",
      recovered: true,
      truncated: true,
      value: {
        model: "test",
        messages: expect.arrayContaining([
          { role: "system", content: "保留用户要求" },
        ]),
      },
    });
  });

  it("unwraps nested serialized JSON while leaving ordinary null and JSON strings readable", () => {
    expect(
      parseModelCallContent(
        JSON.stringify(JSON.stringify({ text: "正文\n第二行" })),
      ),
    ).toMatchObject({ kind: "json", value: { text: "正文\n第二行" } });
    expect(parseModelCallContent("null")).toMatchObject({
      kind: "json",
      value: null,
    });
    expect(parseModelCallContent('"hello"')).toMatchObject({
      kind: "json",
      value: "hello",
    });
  });
});
