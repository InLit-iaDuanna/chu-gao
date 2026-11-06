import { fail, ok } from "@/lib/api-response";
import { chatWorkerOnline } from "@/lib/chat-runtime-health";
import { CHAT_RUNTIME_PROTOCOL_VERSION } from "@/lib/chat-runtime-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const online = await chatWorkerOnline();
  const data = {
    status: online ? "ok" : "degraded",
    protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
  };
  return online
    ? ok(data)
    : fail("CHAT_WORKER_UNAVAILABLE", "兼容的对话执行器未就绪", {
        status: 503,
        details: data,
      });
}
