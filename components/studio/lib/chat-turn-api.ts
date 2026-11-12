import { consumeChatSse } from "@/lib/chat-responses-stream";
import {
  chatIsTerminal,
  type ChatTurnEvent,
  type ChatTurnInput,
  type ChatTurnView,
} from "@/lib/chat-turn-types";
import { isApiError, request } from "./api";
import { prepareChatCreate, resolveChatSubmission } from "./chat-submission";
import { chatHasSearched, type ManagedChatView } from "./chat-turn-view";
import type { ChatStreamHandlers } from "./sse";
import { chatReplyErrorMessage } from "@/lib/turn-credit-types";

export const getActiveChatTurn = (conversationId: string) =>
  request<ChatTurnView | null>(
    `/api/chat/turns?conversationId=${encodeURIComponent(conversationId)}`,
  );
export const getChatTurnSnapshot = (id: string) =>
  request<ChatTurnView>(`/api/chat/turns/${encodeURIComponent(id)}`);
export const cancelManagedChat = (id: string, expectedAttemptId: string) =>
  request<ChatTurnView>(`/api/chat/turns/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ expectedAttemptId }),
  });
export const retryManagedChat = (
  id: string,
  clientRequestId: string,
  expectedPreviousAttemptId: string,
) =>
  request<ChatTurnView>(`/api/chat/turns/${encodeURIComponent(id)}/retry`, {
    method: "POST",
    body: JSON.stringify({ clientRequestId, expectedPreviousAttemptId }),
  });

const activityText: Record<string, string> = {
  queued: "已接受，正在排队…",
  context: "正在整理上下文…",
  preparing_context: "正在整理上下文…",
  waiting_upstream: "正在等待模型响应…",
  reasoning: "正在思考…",
  searching: "正在联网检索…",
  image_tool: "正在准备生图…",
  image_generating: "正在生成图片…",
  answering: "正在生成回复…",
  retrying: "连接中断，正在重试…",
};

export const chatActivityLabel = (activity: string) =>
  activityText[activity] ?? "正在处理…";

export function appendChatActivity(
  history: string[] | undefined,
  activity: string | undefined,
) {
  const next = Array.isArray(history)
    ? history.filter((value): value is string => typeof value === "string")
    : [];
  if (activity && next.at(-1) !== activity) next.push(activity);
  return next;
}
export function chatActivityText(
  view: Pick<
    ManagedChatView,
    "activity" | "status" | "text" | "searched" | "parts"
  >,
) {
  if (view.activity === "retrying") {
    const recovery = (
      view.parts as {
        recovery?: { used?: number; limit?: number; continuing?: boolean };
      } | null
    )?.recovery;
    return `${recovery?.continuing ? "连接中断，正在续写" : "连接中断，正在重试"}（${recovery?.used ?? 1}/${recovery?.limit ?? 2}）…`;
  }
  if (chatHasSearched(view) && !view.text) return "检索已完成，正在等待回复…";
  return chatActivityLabel(view.activity ?? view.status);
}

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    if (signal?.aborted) done();
  });
}

export async function followChatTurn(
  initial: ChatTurnView,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
) {
  let view: ManagedChatView = initial;
  let cursor = view.lastSeq;
  let terminal = false;
  let reconnects = 0;
  let subscription: AbortController | null = null;
  let refreshRequested = false;
  let restartSubscription = false;
  let needsSnapshot = chatIsTerminal(view.status);
  const refresh = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    )
      return;
    refreshRequested = true;
    subscription?.abort();
  };
  const abort = () => subscription?.abort();
  const publish = () => {
    if (signal?.aborted) return;
    handlers.onTurn?.(view);
    handlers.onReplace?.(view.text);
    if (view.generationId) handlers.onGeneration?.(view.generationId);
  };
  const finish = () => {
    if (!chatIsTerminal(view.status) || signal?.aborted) return;
    terminal = true;
    handlers.onConnection?.("connected");
    if (view.status === "completed") handlers.onDone();
    else
      handlers.onError(
        chatReplyErrorMessage(
          view.error?.message ?? "文字回复未完成，已有内容已保存",
        ),
      );
  };
  const reconcile = async () => {
    const next = await getChatTurnSnapshot(view.id);
    if (signal?.aborted) return;
    if (
      next.id !== view.id ||
      next.conversationId !== view.conversationId ||
      next.attemptNumber < view.attemptNumber ||
      (next.attemptId === view.attemptId && next.lastSeq < cursor)
    ) {
      throw new Error("Stale task snapshot");
    }
    view = next;
    cursor = next.lastSeq;
    publish();
    handlers.onStatus?.(chatActivityText(view));
    finish();
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (typeof window !== "undefined") window.addEventListener("focus", refresh);
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", refresh);
  try {
    if (!needsSnapshot) {
      publish();
      handlers.onStatus?.(chatActivityText(view));
    }
    while (!terminal && !signal?.aborted) {
      try {
        // Even a terminal read can race a retry in another tab.
        if (refreshRequested || needsSnapshot) {
          refreshRequested = false;
          await reconcile();
          needsSnapshot = false;
          if (terminal || signal?.aborted) break;
        }
        subscription = new AbortController();
        if (signal?.aborted) break;
        const response = await fetch(
          `/api/chat/turns/${encodeURIComponent(view.id)}/events?after=${cursor}`,
          {
            credentials: "same-origin",
            headers: { Accept: "text/event-stream" },
            signal: subscription.signal,
          },
        );
        if (!response.ok || !response.body)
          throw new Error("Subscription unavailable");
        handlers.onConnection?.("connected");
        await consumeChatSse(
          response.body,
          async (payload) => {
            if (signal?.aborted || refreshRequested) return false;
            const event = payload as ChatTurnEvent;
            if (
              event.v !== 1 ||
              event.turnId !== view.id ||
              !Number.isSafeInteger(event.seq)
            )
              throw new Error("Invalid task event");
            if (event.seq <= cursor) return;
            if (event.seq !== cursor + 1) throw new Error("Event sequence gap");
            cursor = event.seq;
            // A terminal is only a hint: a retry may already have replaced this attempt.
            if (
              event.type === "attempt.terminal" ||
              event.type === "attempt.started" ||
              event.type === "attempt.created" ||
              event.type === "snapshot.required"
            ) {
              needsSnapshot = true;
              await reconcile();
              needsSnapshot = false;
              restartSubscription = !terminal;
              return false;
            }
            if (event.attemptId !== view.attemptId) return;
            const data = event.payload;
            view = { ...view, lastSeq: cursor };
            switch (event.type) {
              case "activity.updated":
                view = {
                  ...view,
                  activity: String(data.activity),
                  activityHistory: appendChatActivity(
                    Array.isArray(data.activityHistory)
                      ? (data.activityHistory as string[])
                      : view.activityHistory,
                    String(data.activity),
                  ),
                  searched: Boolean(data.searched ?? view.searched),
                  ...(data.recovery && typeof data.recovery === "object"
                    ? {
                        parts: {
                          ...(view.parts && typeof view.parts === "object"
                            ? view.parts
                            : {}),
                          recovery: data.recovery,
                        },
                      }
                    : {}),
                };
                if (view.activity !== "queued") view.status = "running";
                handlers.onStatus?.(chatActivityText(view));
                break;
              case "context.updated":
                handlers.onContext?.(
                  data as unknown as import("@/lib/chat-context-types").ChatContextStatus,
                );
                break;
              case "text.delta":
                if (
                  data.offset !== view.text.length ||
                  typeof data.text !== "string"
                )
                  throw new Error("Text offset mismatch");
                view = { ...view, text: view.text + data.text };
                handlers.onDelta(data.text);
                break;
              case "text.snapshot":
                view = { ...view, text: String(data.text ?? "") };
                handlers.onReplace?.(view.text);
                break;
              case "citations.updated":
                if (Array.isArray(data.sources))
                  view = {
                    ...view,
                    sources: data.sources as ChatTurnView["sources"],
                  };
                break;
              case "generation.created":
                if (typeof data.generationId === "string") {
                  view = { ...view, generationId: data.generationId };
                  handlers.onGeneration?.(data.generationId);
                }
                break;
              case "usage.updated":
                if (data.usage && typeof data.usage === "object")
                  view = {
                    ...view,
                    usage: data.usage as Record<string, unknown>,
                  };
                break;
            }
            handlers.onTurn?.(view);
            reconnects = 0;
            return true;
          },
          { signal: subscription.signal, idleMs: 45_000 },
        );
        if (refreshRequested) continue;
        if (restartSubscription) {
          restartSubscription = false;
          continue;
        }
        if (!terminal && !signal?.aborted)
          throw new Error("Subscription ended");
      } catch (error) {
        if (signal?.aborted) break;
        if (isApiError(error) && error.code === "CONTENT_CLEARED") throw error;
        if (refreshRequested) continue;
        handlers.onConnection?.("reconnecting");
        handlers.onStatus?.("连接恢复中，任务可能仍在继续…");
        if (++reconnects > 4) {
          handlers.onConnection?.("disconnected");
          handlers.onStatus?.("连接暂未恢复，生成状态待确认");
          return view;
        }
        await pause(Math.min(4000, reconnects * 500), signal);
        if (signal?.aborted) break;
        // Keep the attempt and cursor. Never submit a replacement task on reconnect.
        needsSnapshot = true;
      } finally {
        subscription?.abort();
        subscription = null;
      }
    }
    return view;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (typeof window !== "undefined")
      window.removeEventListener("focus", refresh);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", refresh);
  }
}

export async function streamManagedChat(
  input: Omit<ChatTurnInput, "clientRequestId"> & {
    userId: string;
    signal?: AbortSignal;
    handlers: ChatStreamHandlers;
  },
) {
  if (input.signal?.aborted) return;
  const { userId, signal, handlers, ...body } = input;
  prepareChatCreate(userId, body);
  const turn = await resolveChatSubmission(userId, body.conversationId);
  if (turn && !signal?.aborted) await followChatTurn(turn, handlers, signal);
}
