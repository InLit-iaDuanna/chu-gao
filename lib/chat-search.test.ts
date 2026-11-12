import { describe, expect, it } from "vitest";
import {
  ChatSearchUnavailableError,
  readCitedResponse,
} from "@/lib/chat-search";

describe("web search citations", () => {
  it("leaves refund promises to the route's confirmed billing outcome", () => {
    expect(new ChatSearchUnavailableError().message).toBe(
      "联网检索未能完成，可关闭联网后重试",
    );
  });
  it("formats citations from structured annotations without exposing internal markers", () => {
    const text = "A fact. citesource";
    const result = readCitedResponse([
      { type: "web_search_call", status: "completed" },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text,
            annotations: [
              {
                type: "url_citation",
                start_index: 8,
                end_index: text.length,
                url: "https://example.org/a(b)",
                title: "Report [1]",
              },
            ],
          },
        ],
      },
    ]);
    expect(result.searched).toBe(true);
    expect(result.finalText).toContain(
      "A fact. [1](https://example.org/a%28b%29)",
    );
    expect(result.finalText).not.toContain("");
    expect(result.finalText).toContain("参考来源");
  });

  it("rejects unsafe URLs and untrusted markdown link labels", () => {
    const result = readCitedResponse([
      {
        type: "web_search_call",
        status: "completed",
        action: {
          sources: [
            { url: "javascript:alert(1)", title: "x" },
            { url: "https://user:password@example.org/private", title: "x" },
            {
              url: "https://example.org/ok",
              title: "] (javascript:alert(1))\n# injected",
            },
          ],
        },
      },
      { type: "message", content: [{ type: "output_text", text: "answer" }] },
    ]);
    expect(result.finalText).not.toContain("](javascript:");
    expect(result.finalText).not.toContain("password");
    expect(result.finalText).not.toContain("\n# injected");
    expect(result.finalText).toContain("https://example.org/ok");
  });

  it("ignores malformed offsets and prioritizes cited sources", () => {
    const result = readCitedResponse([
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "answer",
            annotations: [
              {
                type: "url_citation",
                start_index: -1,
                end_index: 1000,
                url: "https://example.org/first",
              },
            ],
          },
        ],
      },
      {
        type: "web_search_call",
        status: "completed",
        action: {
          sources: Array.from({ length: 30 }, (_, i) => ({
            url: `https://example.org/${i}`,
          })),
        },
      },
    ]);
    expect(result.finalText).toContain("answer");
    expect(result.finalText.match(/^\d+\. /gm)).toHaveLength(1);
  });

  it("bounds the source list when the upstream omits annotations", () => {
    const result = readCitedResponse([
      { type: "message", content: [{ type: "output_text", text: "answer" }] },
      {
        type: "web_search_call",
        status: "completed",
        action: {
          sources: Array.from({ length: 30 }, (_, i) => ({
            url: `https://example.org/${i}`,
          })),
        },
      },
    ]);
    expect(result.finalText.match(/^\d+\. /gm)).toHaveLength(12);
  });
});
