import { describe, expect, it } from "vitest";
import {
  chatEndpoint,
  responsesRequestBody,
  lunaRequestBody,
  readLunaStreamEvent,
} from "@/lib/chat-upstream";

describe("Luna Responses adapter", () => {
  it("keeps prompt caching separate from response storage", () => {
    const body = responsesRequestBody(
      "gpt-6.1-sol",
      [{ role: "user", content: "test" }],
      "stable",
      "low",
      {
        promptCacheKey: "stable-hash",
        promptCacheOptions: { mode: "implicit", ttl: "30m" },
      },
    );
    expect(body).toMatchObject({
      store: false,
      stream: true,
      prompt_cache_key: "stable-hash",
      prompt_cache_options: { mode: "implicit", ttl: "30m" },
    });
    expect(lunaRequestBody([], "stable", "low")).not.toHaveProperty(
      "prompt_cache_options",
    );
  });
  it("keeps history and converts reference images without DeepSeek parameters", () => {
    const body = lunaRequestBody(
      [
        { role: "user", content: "previous request" },
        { role: "assistant", content: "previous answer" },
        {
          role: "user",
          content: [
            { type: "text", text: "inspect" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,abc" },
            },
          ],
        },
      ],
      "our instructions",
      "max",
    );
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      instructions: "our instructions",
      reasoning: { effort: "max" },
      stream: true,
      store: false,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "previous request" }],
        },
        {
          role: "assistant",
          content: [{ type: "output_text", text: "previous answer" }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "inspect" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,abc",
              detail: "auto",
            },
          ],
        },
      ],
    });
    expect(body).not.toHaveProperty("thinking");
    expect(chatEndpoint("https://example.com/v1/", true)).toBe(
      "https://example.com/v1/responses",
    );
  });

  it("keeps explicit non-streaming summary calls independent of chat streaming", () => {
    expect(
      lunaRequestBody(
        [{ role: "user", content: "summarize" }],
        "prompt",
        "low",
        { stream: false },
      ).stream,
    ).toBe(false);
  });

  it("reports tool completion and thinking status without exposing reasoning", () => {
    expect(
      readLunaStreamEvent({ type: "response.web_search_call.completed" }),
    ).toEqual({ searched: true, status: "正在整理检索结果…" });
    expect(
      readLunaStreamEvent({
        type: "response.output_item.done",
        item: { type: "web_search_call", status: "completed" },
      }),
    ).toEqual({ searched: true });
    expect(
      readLunaStreamEvent({
        type: "response.output_item.added",
        item: { type: "reasoning", text: "private chain" },
      }),
    ).toEqual({ status: "正在思考…" });
  });

  it("only publishes answer deltas and never raw reasoning or upstream metadata", () => {
    expect(
      readLunaStreamEvent({
        type: "response.output_text.delta",
        delta: "answer",
      }),
    ).toEqual({ text: "answer" });
    expect(
      readLunaStreamEvent({
        type: "response.reasoning_text.delta",
        delta: "internal",
      }),
    ).toEqual({});
    expect(
      readLunaStreamEvent({
        type: "response.created",
        response: { instructions: "secret" },
      }),
    ).toEqual({});
  });

  it("supports completed-only output without duplicating streamed deltas", () => {
    expect(
      readLunaStreamEvent({
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "answer" }],
            },
          ],
        },
      }),
    ).toEqual({ completed: true, finalText: "answer" });
  });

  it.each(["response.failed", "response.incomplete", "error"])(
    "sanitizes %s",
    (type) => {
      const event = readLunaStreamEvent({
        type,
        error: { message: "secret upstream details" },
      });
      expect(event.error).toBeTruthy();
      expect(JSON.stringify(event)).not.toContain("secret");
      expect(event.completed).toBeUndefined();
    },
  );
});
