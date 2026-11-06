// @vitest-environment node
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  consumeResearchResponse,
  messagesToResponses,
  researchResponsesBody,
} from "./model-protocol";
import { validateResearchArtifact, csvResearchTable } from "./artifacts";
import { makeResearchPlan, researchConfigSchema } from "./config";
import { researchPlanInputSchema } from "./types";
import { researchSourceText } from "./source-text";

describe("research protocol and files", () => {
  it("sends SDK system and developer guidance through native Responses instructions", () => {
    const body = researchResponsesBody(
      {
        instructions: "Root instruction",
        messages: [
          { role: "system", content: "Only research, no file generation" },
          {
            role: "developer",
            content: [{ type: "text", text: "Preserve evidence boundaries" }],
          },
          { role: "user", content: "Compare the supplied sources" },
        ],
      },
      "gpt-6.1-sol",
      "medium",
    );
    expect(body.instructions).toBe(
      "Root instruction\n\nOnly research, no file generation\n\nPreserve evidence boundaries",
    );
    expect(body.input.map((message: { role: string }) => message.role)).toEqual(
      ["user"],
    );
    expect(body.reasoning.effort).toBe("medium");
  });
  it("keeps reasoning and tool call identity when converting a client tool loop", () => {
    const previous = [
      {
        output: [
          { type: "reasoning", encrypted_content: "opaque" },
          {
            type: "function_call",
            call_id: "call_1",
            name: "search",
            arguments: '{"q":"design"}',
          },
        ],
      },
    ];
    const input = messagesToResponses(
      [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              function: { name: "search", arguments: '{"q":"design"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
      ],
      previous,
    );
    expect(input.map((item) => item.type)).toEqual([
      "reasoning",
      "function_call",
      "function_call_output",
    ]);
    expect(input[2].call_id).toBe("call_1");
    const native = researchResponsesBody(
      {
        messages: [{ role: "user", content: "test" }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "sample",
            strict: true,
            schema: { type: "object" },
          },
        },
        tools: [
          {
            type: "function",
            function: { name: "search", parameters: { type: "object" } },
          },
        ],
      },
      "gpt-6.1-sol",
      "high",
    );
    expect(native.text?.format.name).toBe("sample");
    expect(native.tools[0].type).toBe("function");
    expect(
      native.tools.some((tool: { type: string }) => tool.type === "web_search"),
    ).toBe(false);
  });
  it("parses split UTF-8 SSE frames and rejects a stream without completion", async () => {
    const data = [
      { type: "response.output_text.delta", delta: "中文" },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "中文" }],
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    const encoded = new TextEncoder().encode(data);
    const events: unknown[] = [];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < encoded.length; i += 3)
            controller.enqueue(encoded.slice(i, i + 3));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    await expect(
      consumeResearchResponse(response, (event) => {
        events.push(event);
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(events[0]).toMatchObject({ delta: "中文" });
    await expect(
      consumeResearchResponse(
        new Response(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        ),
        () => {},
      ),
    ).rejects.toMatchObject({ code: "PREMATURE_EOF" });
  });
  it("removes encoded file payloads from model context without changing surrounding text", () => {
    expect(
      researchSourceText(
        "原文 ![留档](data:image/png;base64,QUJDRA==) 价格待核验",
      ),
    ).toBe("原文 ![留档]([内嵌文件已留档]) 价格待核验");
  });
  it("records an interrupted socket distinctly without claiming a completed result", async () => {
    let sent = false;
    const events: unknown[] = [];
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"response.output_text.delta","delta":"retained"}\n\n',
              ),
            );
          } else {
            controller.error(
              Object.assign(new TypeError("terminated"), {
                cause: { code: "UND_ERR_SOCKET" },
              }),
            );
          }
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    await expect(
      consumeResearchResponse(response, (event) => {
        events.push(event);
      }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_DISCONNECTED",
      details: { reason: "UND_ERR_SOCKET", retryable: false },
    });
    expect(events).toEqual([
      { type: "response.output_text.delta", delta: "retained" },
    ]);
  });
  it("checks native Office structure and neutralizes spreadsheet formulas", () => {
    const pptx = Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "ppt/presentation.xml": strToU8(
          "<p:presentation><p:sldIdLst><p:sldId/></p:sldIdLst></p:presentation>",
        ),
      }),
    );
    expect(validateResearchArtifact("proposal.pptx", pptx)).toContain(
      "presentationml",
    );
    expect(() =>
      validateResearchArtifact("proposal.pptx", Buffer.from("fake pptx")),
    ).toThrow();
    expect(
      csvResearchTable([
        { name: '=HYPERLINK("http://example.com")', price: "未知" },
      ]),
    ).toContain("'=HYPERLINK");
  });
  it("uses one research engine and reuses a report for a production-only task", () => {
    const input = researchPlanInputSchema.parse({
      brief: { question: "比较五个竞品并制作提案" },
      products: ["pptx"],
    });
    const config = researchConfigSchema.parse({});
    const full = makeResearchPlan(input, config.limits.standard);
    expect(full.preset).toBe("proposal");
    expect(
      full.stages.filter((stage) =>
        ["vane", "gpt-researcher"].includes(stage.engine),
      ),
    ).toHaveLength(1);
    const reused = makeResearchPlan(
      { ...input, sourceTaskId: "original" },
      config.limits.standard,
    );
    expect(reused.stages).toEqual([{ kind: "produce", engine: "deerflow" }]);
  });
});
