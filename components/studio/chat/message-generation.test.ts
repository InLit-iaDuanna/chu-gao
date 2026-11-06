import { expect, it } from "vitest";
import { messageGeneration } from "./message-generation";
import type { ConversationMessage } from "../lib/types";

const message: ConversationMessage = {
  id: "message-1",
  role: "assistant",
  content: "正在生成",
  createdAt: "2026-09-22T00:00:00Z",
  generationId: "generation-1",
  generationModelId: "gpt-image-2.5-flare",
  generationPrompt: "建筑参考图",
  generationStatus: "FAILED",
  generationSize: "2160x3840",
  generationErrorCode: "MODERATION_REJECTED",
  generationErrorMessage: "提示词或参考图触发了内容安全限制",
};

it("preserves generation state, size and actionable failures in the conversation", () => {
  expect(messageGeneration(message, "thread-1")).toMatchObject({
    id: "generation-1",
    conversationId: "thread-1",
    modelId: "gpt-image-2.5-flare",
    status: "FAILED",
    size: "2160x3840",
    errorCode: "MODERATION_REJECTED",
    errorMessage: "提示词或参考图触发了内容安全限制",
  });
});

it("does not duplicate image results on linked user messages", () => {
  expect(
    messageGeneration({ ...message, role: "user" }, "thread-1"),
  ).toBeNull();
  expect(
    messageGeneration({ ...message, generationId: undefined }, "thread-1"),
  ).toBeNull();
});
