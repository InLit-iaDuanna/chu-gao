import { verifyResearchToken } from "@/lib/research/config";
import { activeResearchAttempt } from "@/lib/research/budget";
import { researchFailure } from "@/lib/research/http";
import { researchTool } from "@/lib/research/tools";
import {
  chatCompatibleResearchResponse,
  researchModelCall,
} from "@/lib/research/gateway";
import { ResearchError } from "@/lib/research/errors";
import { researchCallTraceFromHeaders } from "@/lib/research/call-trace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const token =
      request.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
    const attemptId = await verifyResearchToken(token);
    if (!attemptId)
      throw new ResearchError("UNAUTHORIZED", "缺少研究执行凭据", 401);
    const attempt = await activeResearchAttempt(attemptId);
    const route = (await context.params).path.join("/");
    if (route === "v1/models")
      return Response.json({
        object: "list",
        data: [
          {
            id: attempt.stage.task.modelId,
            object: "model",
            owned_by: "chugao",
          },
          {
            id: "intfloat/multilingual-e5-small",
            object: "model",
            owned_by: "local",
          },
        ],
      });
    const text = request.method === "GET" ? "" : await request.text();
    if (text.length > 2_000_000)
      throw new ResearchError("BODY_TOO_LARGE", "研究调用内容过大", 413);
    const body = text
      ? JSON.parse(text)
      : Object.fromEntries(new URL(request.url).searchParams);
    const trace = researchCallTraceFromHeaders(request.headers);
    if (route === "v1/chat/completions")
      return chatCompatibleResearchResponse(
        attemptId,
        body,
        request.signal,
        trace,
      );
    if (route === "v1/responses") {
      if (!body.stream)
        return Response.json(
          await researchModelCall(
            attemptId,
            body,
            () => {},
            request.signal,
            trace,
          ),
        );
      const encoder = new TextEncoder();
      const cancelled = new AbortController();
      let open = true;
      return new Response(
        new ReadableStream({
          async start(controller) {
            try {
              await researchModelCall(
                attemptId,
                body,
                (event) => {
                  if (open)
                    controller.enqueue(
                      encoder.encode(
                        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                      ),
                    );
                },
                AbortSignal.any([request.signal, cancelled.signal]),
                trace,
              );
            } catch (error) {
              if (open)
                controller.enqueue(
                  encoder.encode(
                    `event: error\ndata: ${JSON.stringify({ type: "error", error: { code: error instanceof ResearchError ? error.code : "MODEL_FAILED", message: "研究模型响应中断" } })}\n\n`,
                  ),
                );
            } finally {
              if (open) {
                open = false;
                controller.close();
              }
            }
          },
          cancel() {
            open = false;
            cancelled.abort();
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        },
      );
    }
    if (route === "v1/embeddings")
      return Response.json(
        await researchTool(attemptId, "embed", body, request.signal),
      );
    if (["search", "searx/search"].includes(route))
      return Response.json(
        await researchTool(attemptId, "search", body, request.signal),
      );
    if (route === "crawl")
      return Response.json(
        await researchTool(attemptId, "crawl", body, request.signal),
      );
    throw new ResearchError("NOT_FOUND", "研究内部接口不存在", 404);
  } catch (error) {
    return researchFailure(error);
  }
}
export const GET = handle;
export const POST = handle;
