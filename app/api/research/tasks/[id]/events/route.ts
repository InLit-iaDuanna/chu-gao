import { db } from "@/lib/db";
import { researchAdmin, researchFailure } from "@/lib/research/http";
import { researchTaskView } from "@/lib/research/service";
import { researchTerminal } from "@/lib/research/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  const id = (await context.params).id;
  try {
    await researchTaskView(auth.userId!, id);
  } catch (error) {
    return researchFailure(error);
  }
  let seq = Math.max(
    0,
    Number(
      request.headers.get("last-event-id") ||
        new URL(request.url).searchParams.get("after") ||
        0,
    ),
  );
  if (!Number.isSafeInteger(seq)) seq = 0;
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const start = Date.now();
      try {
        while (
          !closed &&
          !request.signal.aborted &&
          Date.now() - start < 50000
        ) {
          const events = await db.researchEvent.findMany({
            where: { taskId: id, seq: { gt: seq } },
            orderBy: { seq: "asc" },
            take: 300,
          });
          for (const event of events) {
            controller.enqueue(
              encoder.encode(
                `id: ${event.seq}\ndata: ${JSON.stringify({ seq: event.seq, type: event.type, payload: event.payload })}\n\n`,
              ),
            );
            seq = event.seq;
          }
          const task = await db.researchTask.findUnique({
            where: { id },
            select: { status: true, nextSeq: true },
          });
          if (!task || (researchTerminal(task.status) && seq >= task.nextSeq)) {
            controller.enqueue(encoder.encode("event: terminal\ndata: {}\n\n"));
            break;
          }
          if (!events.length) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        }
      } catch {
        if (!closed && !request.signal.aborted)
          controller.enqueue(encoder.encode("event: reconnect\ndata: {}\n\n"));
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
