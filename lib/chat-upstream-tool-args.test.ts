import { describe, expect, it } from "vitest";

import { readAnthropicStreamEvents } from "@/lib/chat-upstream";

describe("anthropic tool_use conversion", () => {
  it("preserves arguments that arrive complete on the start block", () => {
    const events = readAnthropicStreamEvents({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "toolu_1",
        name: "search_web",
        input: { query: "杭州 今天 天气" },
      },
    }) as Array<Record<string, unknown>>;
    const done = events.find(
      (event) => event.type === "response.function_call_arguments.done",
    );
    expect(done).toMatchObject({
      call_id: "toolu_1",
      arguments: JSON.stringify({ query: "杭州 今天 天气" }),
    });
  });

  it("streams deltas when the arguments are chunked", () => {
    const events = readAnthropicStreamEvents({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"query":"杭' },
    });
    expect(events).toEqual([
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: '{"query":"杭',
      },
    ]);
  });
});
