import { afterEach, expect, it, vi } from "vitest";

import {
  CHAT_SEARCH_TOOL,
  CHAT_SEARCH_TOOL_NAME,
  chatSearchToolOutput,
  readSearchAnswer,
  runChatSearchTool,
} from "./chat-search-tool";

afterEach(() => vi.unstubAllGlobals());

const relayAnswer = {
  content: [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
    {
      type: "web_search_tool_result",
      tool_use_id: "s1",
      content: [
        {
          type: "web_search_result",
          title: "OpenAI DevDay 2026",
          url: "https://openai.com/index/devday-2026/",
          encrypted_content: "…",
        },
        {
          type: "web_search_result",
          title: "OpenAI DevDay 2026",
          url: "https://openai.com/index/devday-2026/",
        },
        { type: "web_search_result", title: "Same story", url: "https://example.com/a" },
        { type: "web_search_result", title: "bad", url: "javascript:alert(1)" },
      ],
    },
    { type: "text", text: "I'll search for that.\nFound three things about it." },
  ],
};

it("keeps clean, unique sources and the excerpt text", () => {
  const answer = readSearchAnswer(relayAnswer);
  expect(answer.sources).toEqual([
    { url: "https://openai.com/index/devday-2026/", title: "OpenAI DevDay 2026" },
    { url: "https://example.com/a", title: "Same story" },
  ]);
  expect(answer.text).toBe("Found three things about it.");
});

it("tells the model what the sources are and how careful to be", () => {
  const output = chatSearchToolOutput("openai devday", readSearchAnswer(relayAnswer));
  expect(output).toContain("查询：openai devday");
  expect(output).toContain("1. OpenAI DevDay 2026 | https://openai.com/index/devday-2026/");
  expect(output).toContain("Found three things about it.");
  expect(output).toContain("不要编造");
});

it("describes the tool so the model writes a query, not a sentence", () => {
  expect(CHAT_SEARCH_TOOL.function.name).toBe(CHAT_SEARCH_TOOL_NAME);
  expect(CHAT_SEARCH_TOOL.function.parameters.required).toEqual(["query"]);
  expect(CHAT_SEARCH_TOOL.function.description).toContain("关键词");
});

it("searches through the relay with the model's own query", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(relayAnswer),
  );
  vi.stubGlobal("fetch", fetch);
  const outcome = await runChatSearchTool("  openai devday  ", {
    baseUrl: "https://relay.example.com/v1",
    apiKey: "k",
    model: "claude-opus-5-5",
  });
  expect(outcome.ok).toBe(true);
  expect(outcome.sources).toHaveLength(2);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("https://relay.example.com/v1/messages");
  const body = JSON.parse(String((init as RequestInit).body));
  expect(body.messages[0].content).toBe("openai devday");
  expect(body.tools[0]).toMatchObject({ type: "web_search_20250305", max_uses: 1 });
});

it("reports an empty search instead of inventing sources", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async () => Response.json({ content: [] })),
  );
  const outcome = await runChatSearchTool("no such thing", {
    baseUrl: "https://relay.example.com",
    apiKey: "k",
    model: "claude-opus-5-5",
  });
  expect(outcome.ok).toBe(false);
  expect(outcome.sources).toEqual([]);
  expect(outcome.output).toContain("不要编造");
});

it("survives a relay error and a too-short query", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async () => new Response("nope", { status: 502 })),
  );
  const failed = await runChatSearchTool("openai", {
    baseUrl: "https://relay.example.com",
    apiKey: "k",
    model: "claude-opus-5-5",
  });
  expect(failed.ok).toBe(false);
  expect(failed.output).toContain("HTTP 502");
  const short = await runChatSearchTool(" x ", {
    baseUrl: "https://relay.example.com",
    apiKey: "k",
    model: "claude-opus-5-5",
  });
  expect(short.ok).toBe(false);
  expect(short.output).toContain("太短");
});
