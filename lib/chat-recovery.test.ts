// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ResponsesAccumulator } from "@/lib/chat-responses-stream";
import {
  appendContinuation,
  canRetryChatResponse,
  ChatResponseRecovery,
  continuationMessages,
} from "@/lib/chat-recovery";

const delta = (state: ResponsesAccumulator, text: string) =>
  state.consume({
    type: "response.output_text.delta",
    item_id: "answer",
    sequence_number: 0,
    delta: text,
  });
describe("bounded upstream recovery", () => {
  it("retries forwarding faults and EOF, not refusals, cancellation or permanent errors", () => {
    const state = new ResponsesAccumulator();
    expect(canRetryChatResponse({ state, aborted: false, retries: 0 })).toBe(
      true,
    );
    state.terminal = "failed";
    state.error = {
      type: "upstream_error",
      message: "Unable to forward upstream stream",
    };
    expect(canRetryChatResponse({ state, aborted: false, retries: 1 })).toBe(
      true,
    );
    expect(canRetryChatResponse({ state, aborted: false, retries: 2 })).toBe(
      false,
    );
    expect(canRetryChatResponse({ state, aborted: true, retries: 0 })).toBe(
      false,
    );
    for (const message of [
      "unsafe output",
      "insufficient quota",
      "invalid_request_error",
      "forbidden",
    ])
      expect(
        canRetryChatResponse({
          state: Object.assign(new ResponsesAccumulator(), {
            terminal: "failed",
            error: { message },
          }),
          aborted: false,
          retries: 0,
          reason: "upstream_http_503",
        }),
      ).toBe(false);
    state.consume({ type: "response.refusal.delta", delta: "No" });
    const refusal = new ResponsesAccumulator();
    refusal.consume({ type: "response.refusal.delta", delta: "No" });
    expect(
      canRetryChatResponse({ state: refusal, aborted: false, retries: 0 }),
    ).toBe(false);
  });

  it("only continues output limits when there is retained answer text", () => {
    const state = new ResponsesAccumulator();
    state.terminal = "incomplete";
    state.error = { reason: "max_output_tokens" };
    expect(canRetryChatResponse({ state, aborted: false, retries: 0 })).toBe(
      false,
    );
    state.terminal = null;
    delta(state, "partial");
    state.terminal = "incomplete";
    expect(canRetryChatResponse({ state, aborted: false, retries: 0 })).toBe(
      true,
    );
  });

  it("keeps exact Markdown/HTML prefixes and removes only a long exact overlap", () => {
    const prefix = "```html\n<div>";
    expect(appendContinuation(prefix, "content</div>\n```")).toBe(
      "```html\n<div>content</div>\n```",
    );
    const overlap = "a long exact boundary repeated in the following stream";
    expect(appendContinuation("first:" + overlap, overlap + ":last")).toBe(
      "first:" + overlap + ":last",
    );
    expect(appendContinuation("hello", "hello world")).toBe("hello world");
    expect(appendContinuation("go", "od")).toBe("good");
    expect(appendContinuation("001 | complete\n00", "002 | next")).toBe(
      "001 | complete\n002 | next",
    );
    expect(
      appendContinuation("001 | complete\n002 | unfinished", "002 | un"),
    ).toBe("001 | complete\n002 | unfinished");
    expect(
      appendContinuation(
        "001 | complete\n002 | unfinished",
        "\n002 | unfinished line\n003 | next",
      ),
    ).toBe("001 | complete\n002 | unfinished line\n003 | next");
  });

  it("resets stream sequence identity without dropping earlier sources and public parts", () => {
    const recovery = new ChatResponseRecovery();
    delta(recovery.state, "first ");
    recovery.state.sources = [
      { url: "https://example.com/", title: "Example" },
    ];
    recovery.state.usage = { input_tokens: 1200 };
    recovery.restart("connection_lost");
    delta(recovery.state, "second");
    expect(recovery.text).toBe("first second");
    expect(recovery.sources).toHaveLength(1);
    const checkpoint = recovery.checkpoint();
    expect(new Set(checkpoint.parts.map((part) => part.itemId)).size).toBe(2);
    expect(checkpoint).toMatchObject({
      recovery: {
        used: 1,
        limit: 2,
        attempts: [{ usage: { input_tokens: 1200 } }],
      },
    });
    recovery.restart("connection_lost");
    delta(recovery.state, " third");
    expect(recovery.text).toBe("first second third");
    expect(recovery.checkpoint().parts.map((part) => part.text)).toEqual([
      "first ",
      "second",
      " third",
    ]);
  });

  it("resends the original request and images, then places partial output in an assistant message", () => {
    const original = [{ role: "user" as const, content: "original" }];
    expect(continuationMessages(original, "")).toBe(original);
    expect(continuationMessages(original, "saved")).toEqual([
      ...original,
      { role: "assistant", content: "saved" },
      { role: "user", content: expect.stringContaining("Do not repeat") },
    ]);
  });
});
