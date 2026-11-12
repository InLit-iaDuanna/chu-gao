import { expect, it, vi } from "vitest";
const groupBy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { usageLog: { groupBy } } }));
vi.mock("@/lib/storage", () => ({
  privateImageUrl: () => "/private/image",
  privateImageThumbnailUrl: () => "/private/thumbnail",
}));
import {
  serializeConversation,
  type ConversationWithMessages,
} from "./conversations";

it("restores each historical attempt's actual settlement and image ledger without changing balances or inventing completion", async () => {
  groupBy.mockResolvedValue([
    { generationId: "image", action: "generate", _sum: { creditsDelta: -19 } },
    { generationId: "image", action: "refund", _sum: { creditsDelta: 2 } },
  ]);
  const now = new Date("2026-11-12T00:00:00Z");
  const row = {
    id: "conversation",
    userId: "owner",
    title: "历史对话",
    createdAt: now,
    lastMessageAt: now,
    chatTurns: [
      {
        id: "image-turn",
        activeAttemptId: "image-attempt",
        chargedCredits: 0,
        attempts: [
          {
            id: "image-attempt",
            ordinal: 1,
            billingState: "released",
            heldCredits: 5,
            usage: null,
          },
        ],
      },
      {
        id: "text-turn",
        activeAttemptId: "text-attempt",
        chargedCredits: 0.234567,
        attempts: [
          {
            id: "text-attempt",
            ordinal: 1,
            billingState: "charged",
            heldCredits: 20,
            usage: null,
          },
        ],
      },
    ],
    messages: [
      {
        id: "image-reply",
        role: "ASSISTANT",
        content: "收到的部分文字",
        chatTurnId: "image-turn",
        chatAttemptId: "image-attempt",
        chatStatus: "interrupted",
        chatError: { publicMessage: "对话未完成，本轮未收费" },
        createdAt: now,
        generationId: "image",
        generation: {
          id: "image",
          status: "SUCCEEDED",
          prompt: "原图提示词",
          modelId: "image-model",
          paramsRaw: {},
          costCredits: 999,
          n: 1,
          progress: 100,
          images: [],
        },
      },
      {
        id: "text-reply",
        role: "ASSISTANT",
        content: "完整文字",
        chatTurnId: "text-turn",
        chatAttemptId: "text-attempt",
        chatStatus: "completed",
        createdAt: now,
        chatUsage: null,
        generation: null,
      },
    ],
  } as unknown as ConversationWithMessages;
  const view = await serializeConversation(row);
  expect(view.messages[0]).toMatchObject({
    chatStatus: "interrupted",
    chatBilling: { state: "released", chargedCredits: 0 },
    generationStatus: "SUCCEEDED",
    generationBilling: {
      state: "refunded",
      chargedCredits: 17,
      refundedCredits: 2,
    },
    generationCostCredits: 999,
  });
  expect(view.messages[0].chatError).not.toContain("本轮未收费");
  expect(view.messages[1].chatBilling).toEqual({
    state: "charged",
    chargedCredits: 0.234567,
  });
  expect(groupBy).toHaveBeenCalledTimes(1);
});
