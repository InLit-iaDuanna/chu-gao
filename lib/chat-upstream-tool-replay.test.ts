import { describe, expect, it } from "vitest";

import { anthropicMessagesRequestBody } from "@/lib/chat-upstream";

const continuation = {
  callId: "toolu_1",
  name: "generate_image",
  arguments: '{"prompt":"一群人"}',
  output: '{"ok":true,"generationId":"g1"}',
};

describe("anthropic post-tool round", () => {
  it("replays the tool exchange as text when no tools are offered", () => {
    const body = anthropicMessagesRequestBody(
      "claude-opus-5-5",
      [{ role: "user", content: "生成一群人" }],
      "system",
      "low",
      { webSearch: false, tools: [], toolContinuations: [continuation] },
    );
    expect(body).not.toHaveProperty("tools");
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: '[已调用 generate_image]\n{"prompt":"一群人"}',
    });
    expect(String(body.messages[2].content)).toContain('"generationId":"g1"');
    expect(JSON.stringify(body)).not.toContain("tool_use");
  });

  it("keeps native tool blocks while tools are still defined", () => {
    const body = anthropicMessagesRequestBody(
      "claude-opus-5-5",
      [{ role: "user", content: "生成一群人" }],
      "system",
      "low",
      { tools: [{ name: "generate_image" }], toolContinuations: [continuation] },
    );
    expect(JSON.stringify(body.messages)).toContain('"type":"tool_use"');
  });
});
