import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import {
  CHAT_RUNTIME_PROTOCOL_VERSION,
  chatRuntimeUpdateSchema,
  setChatRuntimeConfig,
} from "@/lib/chat-runtime-config";
import { getChatRuntimeStatus } from "@/lib/chat-runtime-health";
import { readJsonBodySafe } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  return ok(await getChatRuntimeStatus());
}

export async function PATCH(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = chatRuntimeUpdateSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "对话运行时配置不合法", { status: 400 });
  const actorId = authenticatedUser(session).id;
  const config = await setChatRuntimeConfig(parsed.data, actorId);
  await audit({
    actorId,
    action: "admin.chat.runtime.update",
    target: "chat.runtime",
    diff: parsed.data,
    request,
  });
  return ok({ config, protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION });
}
