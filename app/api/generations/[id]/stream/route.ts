import { errorBody } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/generations";
import { getProviderChannelDisplayNameMap } from "@/lib/provider-channel-config";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

function safeEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  chunk: Uint8Array,
): boolean {
  try {
    controller.enqueue(chunk);
    return true;
  } catch {
    return false;
  }
}

function safeClose(
  controller: ReadableStreamDefaultController<Uint8Array>,
): void {
  try {
    controller.close();
  } catch {
    // The browser may have already closed the SSE connection.
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const errorEvent = (code: string, message: string, details?: unknown) =>
    encoder.encode(
      `event: error\ndata: ${JSON.stringify(errorBody(code, message, details))}\n\n`,
    );

  const stream = new ReadableStream({
    async start(controller) {
      if (!process.env.DATABASE_URL) {
        safeEnqueue(
          controller,
          errorEvent("SERVICE_UNAVAILABLE", "生成服务未配置数据库"),
        );
        safeClose(controller);
        return;
      }

      if (sessionResult.status === "unavailable") {
        safeEnqueue(
          controller,
          errorEvent("AUTH_UNAVAILABLE", "认证服务暂时不可用"),
        );
        safeClose(controller);
        return;
      }

      if (sessionResult.status === "unauthenticated") {
        safeEnqueue(controller, errorEvent("UNAUTHORIZED", "请先登录"));
        safeClose(controller);
        return;
      }

      const session = sessionResult.user;
      const displayNameMap = await getProviderChannelDisplayNameMap();
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const close = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        if (!closed) {
          closed = true;
          safeClose(controller);
        }
      };
      cleanup = close;

      const send = async () => {
        if (closed) {
          return;
        }

        try {
          const generation = await db.generation.findFirst({
            where: {
              id,
              userId: session.id,
              deletedAt: null,
            },
            include: {
              images: true,
              provider: {
                select: {
                  id: true,
                  name: true,
                },
              },
              providerAccount: {
                select: {
                  id: true,
                  name: true,
                  baseUrl: true,
                },
              },
            },
          });

          if (!generation) {
            safeEnqueue(controller, errorEvent("NOT_FOUND", "任务不存在"));
            close();
            return;
          }

          if (!safeEnqueue(
            controller,
            encoder.encode(
              `event: update\ndata: ${JSON.stringify(serializeGeneration(generation, { displayNameMap }))}\n\n`,
            ),
          )) {
            close();
            return;
          }

          if (TERMINAL_STATUSES.has(generation.status)) {
            close();
            return;
          }
        } catch (error) {
          if (isDatabaseUnavailableError(error)) {
            safeEnqueue(
              controller,
              errorEvent("SERVICE_UNAVAILABLE", "生成服务暂时不可用"),
            );
            close();
            return;
          }

          safeEnqueue(controller, errorEvent("INTERNAL_ERROR", "任务状态读取失败"));
          close();
          return;
        }

        timer = setTimeout(send, 2000);
      };

      await send();
    },
    cancel() {
      cleanup();
      return undefined;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
