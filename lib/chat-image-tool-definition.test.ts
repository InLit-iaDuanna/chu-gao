import { describe, expect, it } from "vitest";
import {
  CHAT_IMAGE_RESPONSES_TOOL,
  CHAT_IMAGE_TOOL,
  CHAT_IMAGE_TOOL_DESCRIPTION,
  CHAT_IMAGE_TOOL_NAME,
  chatImageToolOutput,
} from "@/lib/chat-image-tool-definition";

describe("generate_image definition", () => {
  it("is identical in the chat completions and responses shapes", () => {
    expect(CHAT_IMAGE_TOOL.function.name).toBe(CHAT_IMAGE_TOOL_NAME);
    expect(CHAT_IMAGE_RESPONSES_TOOL.name).toBe(CHAT_IMAGE_TOOL_NAME);
    expect(CHAT_IMAGE_TOOL.function.description).toBe(
      CHAT_IMAGE_TOOL_DESCRIPTION,
    );
    expect(CHAT_IMAGE_RESPONSES_TOOL.description).toBe(
      CHAT_IMAGE_TOOL_DESCRIPTION,
    );
    expect(CHAT_IMAGE_RESPONSES_TOOL.parameters).toBe(
      CHAT_IMAGE_TOOL.function.parameters,
    );
  });

  it("is not strict on Responses, so omitted parameters stay omitted", () => {
    // Strict mode makes the model fill every property, which overrides the
    // user's image settings with n: 1, quality: "auto" and so on.
    expect(CHAT_IMAGE_RESPONSES_TOOL.strict).toBe(false);
    expect(CHAT_IMAGE_TOOL.function.parameters.required).toEqual(["prompt"]);
  });

  it("says what the call returns and how often it may be made", () => {
    expect(CHAT_IMAGE_TOOL_DESCRIPTION).toContain("每轮最多调用一次");
    expect(CHAT_IMAGE_TOOL_DESCRIPTION).toContain("不是图片本身");
  });

  it("only requires the prompt and hides parameters the model cannot know", () => {
    const { parameters } = CHAT_IMAGE_TOOL.function;
    expect(parameters.required).toEqual(["prompt"]);
    expect(parameters.additionalProperties).toBe(false);
    expect(Object.keys(parameters.properties)).toEqual([
      "prompt",
      "size",
      "quality",
      "outputFormat",
      "background",
      "n",
      "source_images",
    ]);
  });

  it("lets the model reference earlier generated images by id or latest", () => {
    const { source_images } = CHAT_IMAGE_TOOL.function.parameters.properties;
    expect(source_images).toMatchObject({
      type: "array",
      maxItems: 4,
      items: { type: "string" },
    });
    expect(source_images.description).toContain("[本条回复生成的图片]");
    expect(source_images.description).toContain("latest");
    expect(CHAT_IMAGE_TOOL_DESCRIPTION).toContain("source_images");
  });

  it("tells the model when to pass each optional parameter", () => {
    const { prompt, ...optional } =
      CHAT_IMAGE_TOOL.function.parameters.properties;
    expect(prompt.description).toContain("看不到对话");
    for (const parameter of Object.values(optional))
      expect(parameter.description).toMatch(/省略/);
  });
});

describe("generate_image receipt", () => {
  it("reports the real submission, never a finished image, and omits credits and model", () => {
    const output = chatImageToolOutput({
      ok: true,
      generationId: "generation-a",
      status: "PENDING",
      estimatedCredits: 6,
      modelId: "gpt-image-2",
    });
    const receipt = JSON.parse(output);
    expect(receipt).toMatchObject({
      ok: true,
      generationId: "generation-a",
      status: "PENDING",
    });
    expect(receipt.next).toContain("还没有生成");
    expect(output).not.toContain("gpt-image-2");
    expect(Object.keys(receipt)).toEqual([
      "ok",
      "generationId",
      "status",
      "next",
    ]);
  });

  it.each([
    "INVALID_TOOL_ARGUMENTS",
    "INVALID_TOOL_CALL",
    "UNSUPPORTED_TOOL_CALL",
    "INSUFFICIENT_CREDITS",
    "QUEUE_UNAVAILABLE",
    "IMAGE_TOOL_UNAVAILABLE",
    "UNSUPPORTED_PARAM",
    "MODEL_NOT_AVAILABLE",
    "REFERENCE_IMAGE_NOT_FOUND",
    "MODERATION_REJECTED",
    "CONVERSATION_NOT_FOUND",
    "SOURCE_IMAGE_NOT_FOUND",
    "TOO_MANY_SOURCE_IMAGES",
    "TOO_MANY_REFERENCE_IMAGES",
    "SOMETHING_NEW",
  ])("gives a next step for %s", (code) => {
    const receipt = JSON.parse(
      chatImageToolOutput({ ok: false, code, message: "原因" }),
    );
    expect(receipt).toMatchObject({ ok: false, code, message: "原因" });
    expect(receipt.next).toContain("没有提交");
  });

  it("does not coach the model to work around moderation", () => {
    const receipt = JSON.parse(
      chatImageToolOutput({
        ok: false,
        code: "MODERATION_REJECTED",
        message: "原因",
      }),
    );
    expect(receipt.next).toContain("不要帮用户改写来规避审核");
  });
});
