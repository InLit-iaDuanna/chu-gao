import { errorBody } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/generations";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

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
        controller.enqueue(
          errorEvent("SERVICE_UNAVAILABLE", "生成服务未配置数据库"),
        );
        controller.close();
        return;
      }

      if (sessionResult.status === "unavailable") {
        controller.enqueue(
          errorEvent("AUTH_UNAVAILABLE", "认证服务暂时不可用"),
        );
        controller.close();
        return;
      }

      if (sessionResult.status === "unauthenticated") {
        controller.enqueue(errorEvent("UNAUTHORIZED", "请先登录"));
        controller.close();
        return;
      }

      const session = sessionResult.user;
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const close = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        if (!closed) {
          closed = true;
          controller.close();
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
            },
          });

          if (!generation) {
            controller.enqueue(errorEvent("NOT_FOUND", "任务不存在"));
            close();
            return;
          }

          controller.enqueue(
            encoder.encode(
              `event: update\ndata: ${JSON.stringify(serializeGeneration(generation))}\n\n`,
            ),
          );

          if (TERMINAL_STATUSES.has(generation.status)) {
            close();
            return;
          }
        } catch (error) {
          if (isDatabaseUnavailableError(error)) {
            controller.enqueue(
              errorEvent("SERVICE_UNAVAILABLE", "生成服务暂时不可用"),
            );
            close();
            return;
          }

          controller.enqueue(errorEvent("INTERNAL_ERROR", "任务状态读取失败"));
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
