// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  consumeChatSse,
  ResponsesAccumulator,
} from "@/lib/chat-responses-stream";
import { responsesRequestBody } from "@/lib/chat-upstream";

function bytes(text: string, oneByte = false) {
  const value = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (oneByte)
        for (const byte of value) controller.enqueue(new Uint8Array([byte]));
      else controller.enqueue(value);
      controller.close();
    },
  });
}

describe("Responses native stream", () => {
  it("uses the verified Sol request shape without old model constants", () => {
    expect(
      responsesRequestBody(
        "gpt-6.1-sol",
        [{ role: "user", content: "check" }],
        "instructions",
        "low",
        { webSearch: true, maxOutputTokens: 4096 },
      ),
    ).toMatchObject({
      model: "gpt-6.1-sol",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "check" }],
        },
      ],
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      include: [],
      stream: true,
      store: false,
      max_output_tokens: 4096,
    });
  });

  it("handles UTF-8 byte boundaries, split CRLF, multi-line data and whitespace", async () => {
    const state = new ResponsesAccumulator();
    await consumeChatSse(
      bytes(
        ': ping\r\ndata: {"type":\r\ndata: "response.output_text.delta","item_id":"a","delta":"中😀 文\\n"}\r\n\r\n',
        true,
      ),
      async (value) => state.consume(value),
    );
    expect(state.rawText).toBe("中😀 文\n");
    expect(state.terminal).toBeNull();
  });

  it("preserves pure whitespace and ignores duplicate upstream sequence numbers", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.output_text.delta",
      item_id: "a",
      delta: "a",
      sequence_number: 0,
    });
    state.consume({
      type: "response.output_text.delta",
      item_id: "a",
      delta: "a",
      sequence_number: 0,
    });
    state.consume({
      type: "response.output_text.delta",
      item_id: "a",
      delta: " \n",
      sequence_number: 1,
    });
    expect(state.rawText).toBe("a \n");
  });

  it("does not accept item.done or EOF as response completion", async () => {
    const state = new ResponsesAccumulator();
    await consumeChatSse(
      bytes(
        `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { id: "a", type: "message", content: [{ type: "output_text", text: "partial" }] } })}\n\n`,
      ),
      async (value) => state.consume(value),
    );
    expect(state.rawText).toBe("partial");
    expect(state.terminal).toBeNull();
  });

  it("keeps the first explicit failure despite later completion or cleanup events", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.output_text.delta",
      item_id: "a",
      delta: "partial",
    });
    state.consume({
      type: "response.failed",
      response: {
        error: {
          type: "upstream_error",
          message: "Unable to forward upstream stream",
        },
      },
    });
    state.consume({
      type: "response.completed",
      response: { status: "completed", output: [] },
    });
    expect(state.terminal).toBe("failed");
    expect(state.rawText).toBe("partial");
    expect(state.error?.message).toBe("Unable to forward upstream stream");
  });

  it("reconciles an authoritative final rewrite without duplicating parts", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.output_text.delta",
      item_id: "a",
      delta: "draft",
    });
    state.consume({
      type: "response.completed",
      response: {
        status: "completed",
        usage: { input_tokens: 12, output_tokens: 4 },
        output: [
          {
            type: "message",
            id: "a",
            content: [{ type: "output_text", text: "final answer" }],
          },
        ],
      },
    });
    expect(state.rawText).toBe("final answer");
    expect(state.finalText).toBe("final answer");
    expect(state.usage?.input_tokens).toBe(12);
  });

  it("records real search completion and citations without exposing reasoning", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.output_item.added",
      item: { type: "reasoning" },
    });
    state.consume({ type: "response.reasoning_text.delta", delta: "private" });
    state.consume({ type: "response.web_search_call.completed" });
    state.consume({
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          {
            type: "message",
            id: "a",
            content: [
              {
                type: "output_text",
                text: "source",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.org/reference",
                    title: "Reference",
                    start_index: 0,
                    end_index: 6,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(state.searched).toBe(true);
    expect(state.sources).toHaveLength(1);
    expect(state.finalText).not.toContain("private");
    expect(state.usage).toBeNull();
  });

  it("reports malformed JSON instead of silently losing an event", async () => {
    await expect(
      consumeChatSse(bytes("data: {broken}\n\n"), async () => undefined),
    ).rejects.toThrow("Malformed JSON");
  });

  it("deduplicates annotation identities and checkpoints range-only revisions", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.output_text.delta",
      item_id: "a",
      output_index: 1,
      content_index: 2,
      delta: "reference",
    });
    const annotation = {
      type: "response.output_text.annotation.added",
      item_id: "a",
      output_index: 1,
      content_index: 2,
      annotation_index: 4,
      annotation: {
        type: "url_citation",
        url: "https://example.org",
        title: "Source",
        start_index: 0,
        end_index: 4,
      },
    };
    state.consume(annotation);
    const revision = state.revision;
    state.consume(annotation);
    expect(state.orderedParts()[0].annotations).toHaveLength(1);
    expect(state.revision).toBe(revision);
    state.consume({
      ...annotation,
      annotation: { ...annotation.annotation, end_index: 6 },
    });
    expect(state.revision).toBeGreaterThan(revision);
    expect(state.orderedParts()[0]).toMatchObject({
      itemId: "a",
      outputIndex: 1,
      contentIndex: 2,
      annotations: [
        { annotationIndex: 4, itemId: "a", contentIndex: 2, end_index: 6 },
      ],
    });
    expect(state.sources).toHaveLength(1);
  });

  it("retains per-tool identity, actual search actions and public item metadata only", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.output_item.added",
      output_index: 0,
      item: {
        id: "reason",
        type: "reasoning",
        status: "in_progress",
        summary: [{ text: "private" }],
        encrypted_content: "secret",
      },
    });
    for (const [index, id] of ["search-a", "search-b"].entries()) {
      state.consume({
        type: "response.output_item.added",
        output_index: index + 1,
        item: { id, type: "web_search_call", status: "in_progress" },
      });
      state.consume({
        type: "response.output_item.done",
        output_index: index + 1,
        item: {
          id,
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: id,
            sources: [{ url: "https://example.org", title: "Source" }],
          },
        },
      });
    }
    state.consume({
      type: "response.output_item.done",
      output_index: 3,
      item: {
        id: "answer",
        type: "message",
        role: "assistant",
        phase: "final_answer",
        status: "completed",
        content: [{ type: "refusal", refusal: "No" }],
      },
    });
    const checkpoint = state.checkpoint();
    expect(checkpoint.items).toHaveLength(4);
    expect(checkpoint.items[1]).toMatchObject({
      itemId: "search-a",
      status: "completed",
      action: { query: "search-a" },
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
    });
    expect(checkpoint.items[3]).toMatchObject({
      role: "assistant",
      phase: "final_answer",
    });
    expect(state.rawText).toBe("No");
    expect(JSON.stringify(checkpoint)).not.toMatch(
      /private|secret|encrypted_content/,
    );
  });

  it("retains failed response output, citations, usage and provider terminal status", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.created",
      response: { id: "response-a", status: "in_progress" },
    });
    state.consume({
      type: "response.failed",
      response: {
        status: "failed",
        usage: { input_tokens: 7 },
        error: { code: "broken" },
        output: [
          {
            id: "a",
            type: "message",
            content: [
              {
                type: "output_text",
                text: "partial",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.org",
                    start_index: 0,
                    end_index: 3,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(state.rawText).toBe("partial");
    expect(state.sources).toHaveLength(1);
    expect(state.usage).toEqual({ input_tokens: 7 });
    expect(state.checkpoint()).toMatchObject({
      providerStatus: "failed",
      responseId: "response-a",
      usageAvailability: "reported",
    });
  });

  it("exposes completed searches awaiting text even without the search subtype event", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "search", type: "web_search_call", status: "in_progress" },
    });
    expect(state.activity).toBe("searching");
    state.consume({
      type: "response.output_item.done",
      output_index: 0,
      item: { id: "search", type: "web_search_call", status: "completed" },
    });
    expect(state.activity).toBe("waiting_upstream");
    expect(state.searched).toBe(true);
  });

  it("adopts late item IDs without duplicating fallback text parts", () => {
    const state = new ResponsesAccumulator();
    state.consume({
      type: "response.output_text.delta",
      output_index: 1,
      delta: "draft",
    });
    state.consume({
      type: "response.output_item.done",
      output_index: 1,
      item: {
        id: "actual",
        type: "message",
        content: [{ type: "output_text", text: "draft" }],
      },
    });
    expect(state.orderedParts()).toHaveLength(1);
    expect(state.orderedParts()[0].itemId).toBe("actual");
    expect(state.partDiagnostics()[0].matchesFinalRaw).toBe(true);
  });

  it("delivers the last good event before a malformed frame, not later completion", async () => {
    const state = new ResponsesAccumulator();
    const delta = {
      type: "response.output_text.delta",
      item_id: "a",
      delta: "retained",
    };
    await expect(
      consumeChatSse(
        bytes(
          `data: ${JSON.stringify(delta)}\n\ndata: {broken}\n\ndata: {"type":"response.completed"}\n\n`,
        ),
        async (value) => {
          state.consume(value);
          return !state.terminal;
        },
      ),
    ).rejects.toThrow("Malformed JSON");
    expect(state.rawText).toBe("retained");
    expect(state.terminal).toBeNull();
  });
});
