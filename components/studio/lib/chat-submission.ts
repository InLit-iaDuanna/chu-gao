import { z } from "zod";
import type { ChatTurnInput, ChatTurnView } from "@/lib/chat-turn-types";
import { ApiError, isApiError, request } from "./api";

const pendingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    input: z
      .object({
        conversationId: z.string(),
        clientRequestId: z.string(),
        content: z.string(),
        modelId: z.string(),
        referenceImageKeys: z.array(z.string()),
        sourceImageIds: z.array(z.string()),
      })
      .passthrough(),
  }),
  z.object({
    kind: z.literal("retry"),
    turnId: z.string(),
    clientRequestId: z.string(),
    expectedPreviousAttemptId: z.string(),
  }),
]);
const receiptSchema = z.object({
  version: z.literal(1),
  turnId: z.string().optional(),
  pending: pendingSchema.optional(),
});
export type ChatReceipt = z.infer<typeof receiptSchema>;
export type PendingChatSubmission = z.infer<typeof pendingSchema>;

export const chatReceiptKey = (userId: string, conversationId: string) =>
  `chugao.chat-receipt.v1.${encodeURIComponent(userId)}.${encodeURIComponent(conversationId)}`;

export function readChatReceipt(
  userId: string,
  conversationId: string,
): ChatReceipt | null {
  try {
    const raw = localStorage.getItem(chatReceiptKey(userId, conversationId));
    return raw ? receiptSchema.parse(JSON.parse(raw)) : null;
  } catch {
    // A missing or unreadable receipt must never silently allocate a new request key.
    throw new Error("无法读取发送凭据，暂未提交新任务；请恢复浏览器存储后重试");
  }
}

function writeReceipt(
  userId: string,
  conversationId: string,
  receipt: ChatReceipt,
) {
  try {
    localStorage.setItem(
      chatReceiptKey(userId, conversationId),
      JSON.stringify(receipt),
    );
  } catch {
    throw new Error("无法保存发送凭据，暂未提交新任务；请恢复浏览器存储后重试");
  }
}

export function clearChatReceipt(
  userId: string,
  conversationId: string,
  expected: { turnId?: string; clientRequestId?: string },
) {
  const current = readChatReceipt(userId, conversationId);
  if (!current) return;
  const pendingKey =
    current.pending?.kind === "create"
      ? current.pending.input.clientRequestId
      : current.pending?.clientRequestId;
  if (
    pendingKey
      ? pendingKey !== expected.clientRequestId
      : current.turnId !== expected.turnId
  )
    return;
  localStorage.removeItem(chatReceiptKey(userId, conversationId));
}

export function rememberChatTurn(
  userId: string,
  turn: ChatTurnView,
  clientRequestId: string,
) {
  const current = readChatReceipt(userId, turn.conversationId);
  const pendingKey =
    current?.pending?.kind === "create"
      ? current.pending.input.clientRequestId
      : current?.pending?.clientRequestId;
  if (pendingKey && pendingKey !== clientRequestId) return;
  writeReceipt(userId, turn.conversationId, { version: 1, turnId: turn.id });
}

export function prepareChatSubmission(
  userId: string,
  conversationId: string,
  operation: () => PendingChatSubmission,
): PendingChatSubmission {
  const receipt = readChatReceipt(userId, conversationId);
  if (receipt?.pending) return receipt.pending;
  const pending = operation();
  writeReceipt(userId, conversationId, { ...receipt, version: 1, pending });
  return pending;
}

function pendingCreateBody(
  input: Extract<PendingChatSubmission, { kind: "create" }>['input'],
) {
  const { referenceOrder, ...body } = input;
  void referenceOrder;
  return body;
}

export async function resolveChatSubmission(
  userId: string,
  conversationId: string,
): Promise<ChatTurnView | null> {
  const receipt = readChatReceipt(userId, conversationId);
  const pending = receipt?.pending;
  if (!pending) return null;
  const clientRequestId =
    pending.kind === "create"
      ? pending.input.clientRequestId
      : pending.clientRequestId;
  try {
    const known = await request<ChatTurnView | null>(
      `/api/chat/turns?conversationId=${encodeURIComponent(conversationId)}&clientRequestId=${encodeURIComponent(clientRequestId)}`,
    );
    const turn =
      known ??
      (await request<ChatTurnView>(
        pending.kind === "create"
          ? "/api/chat/turns"
          : `/api/chat/turns/${encodeURIComponent(pending.turnId)}/retry`,
        {
          method: "POST",
          body: JSON.stringify(
            pending.kind === "create"
              ? pendingCreateBody(pending.input)
              : {
                  clientRequestId: pending.clientRequestId,
                  expectedPreviousAttemptId: pending.expectedPreviousAttemptId,
                },
          ),
        },
      ));
    rememberChatTurn(userId, turn, clientRequestId);
    return turn;
  } catch (error) {
    if (
      isApiError(error) &&
      error.code === "ATTEMPT_CHANGED" &&
      pending.kind === "retry"
    ) {
      const latest = await request<ChatTurnView>(
        `/api/chat/turns/${encodeURIComponent(pending.turnId)}`,
      );
      if (latest.attemptId !== pending.expectedPreviousAttemptId) {
        rememberChatTurn(userId, latest, clientRequestId);
        return latest;
      }
    }
    if (isApiError(error) && error.code === "CONTENT_CLEARED") {
      clearChatReceipt(userId, conversationId, { clientRequestId });
      throw new ApiError(
        "CONTENT_CLEARED",
        "这次提交对应的内容已清空，不会重新执行。请确认后再发送新消息",
        410,
      );
    }
    if (
      isApiError(error) &&
      ((error.status >= 400 &&
        error.status < 500 &&
        ![408, 409, 429].includes(error.status)) ||
        ["CHAT_TURN_BUSY", "CONVERSATION_CHANGED", "RETRY_LIMIT"].includes(
          error.code,
        ))
    ) {
      const current = readChatReceipt(userId, conversationId);
      const pendingKey =
        current?.pending?.kind === "create"
          ? current.pending.input.clientRequestId
          : current?.pending?.clientRequestId;
      if (pendingKey === clientRequestId)
        writeReceipt(userId, conversationId, {
          version: 1,
          turnId: current?.turnId,
        });
      throw error;
    }
    throw new Error(
      "提交结果尚未确认，发送凭据已保留。恢复连接会查询或复用原请求，不会创建第二轮回复",
    );
  }
}

export function prepareChatCreate(
  userId: string,
  input: Omit<ChatTurnInput, "clientRequestId">,
) {
  return prepareChatSubmission(userId, input.conversationId, () => ({
    kind: "create",
    input: { ...input, clientRequestId: crypto.randomUUID() },
  }));
}
