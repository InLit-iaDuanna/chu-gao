import { fail } from "@/lib/api-response";
import { chatRequestUser, chatTurnFailure } from "@/lib/chat-turn-http";
import { getChatTurn, serializeChatEvent } from "@/lib/chat-turns";
import { chatIsTerminal } from "@/lib/chat-turn-types";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const rawCursor =
    new URL(request.url).searchParams.get("after") ??
    request.headers.get("last-event-id")?.replace(`${id}:`, "") ??
    "0";
  if (!/^\d{1,10}$/.test(rawCursor))
    return fail("VALIDATION_ERROR", "无效的事件位置", { status: 400 });
  let after = Number(rawCursor);
  try {
    const turn = await getChatTurn(auth.userId!, id);
    if (after > turn.lastSeq)
      return fail("VALIDATION_ERROR", "事件位置超出范围", { status: 400 });
  } catch (error) {
    return chatTurnFailure(error);
  }
  const encoder = new TextEncoder();
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let heartbeat = Date.now();
      let reconciledAt = Date.now();
      request.signal.addEventListener("abort", stop, { once: true });
      try {
        while (!stopped && !request.signal.aborted) {
          if (Date.now() - reconciledAt > 5_000) {
            // Subscription-driven reconciliation also releases lost holds when
            // the only worker was killed and has not restarted yet.
            await getChatTurn(auth.userId!, id);
            reconciledAt = Date.now();
          }
          const rows = await db.chatEvent.findMany({
            where: { turnId: id, seq: { gt: after } },
            orderBy: { seq: "asc" },
            take: 100,
          });
          for (const row of rows) {
            if (stopped || request.signal.aborted) break;
            const event = serializeChatEvent(row);
            controller.enqueue(
              encoder.encode(
                `id: ${id}:${event.seq}\nevent: turn\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
            if (
              (event.type === "text.delta" || event.type === "text.snapshot") &&
              typeof event.payload.text === "string" &&
              event.payload.text.length
            )
              await db.chatAttempt.updateMany({
                where: { id: event.attemptId, firstTextSentAt: null },
                data: { firstTextSentAt: new Date() },
              });
            after = event.seq;
          }
          const turn = await db.chatTurn.findFirst({
            where: {
              id,
              userId: auth.userId!,
              conversation: { archivedAt: null },
            },
            select: { status: true, nextSeq: true },
          });
          if (!turn || (chatIsTerminal(turn.status) && after >= turn.nextSeq))
            break;
          if (Date.now() - heartbeat > 15_000) {
            controller.enqueue(encoder.encode(": ping\n\n"));
            heartbeat = Date.now();
          }
          if (rows.length < 100)
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
      } catch {
        // Closing a subscription never changes the task's execution state.
      } finally {
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          /* Subscriber already closed. */
        }
      }
    },
    cancel: stop,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
