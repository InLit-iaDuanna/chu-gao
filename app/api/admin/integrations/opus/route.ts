import { fail, ok } from "@/lib/api-response";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  getOpusStatus,
  opusConfigUpdateSchema,
  setOpusConfig,
} from "@/lib/opus-config";
import { readJsonBodySafe } from "@/lib/request-body";

export async function GET(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  return ok(await getOpusStatus(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = opusConfigUpdateSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "Opus 配置参数不合法", { status: 400 });
  await setOpusConfig(parsed.data);
  const { apiKey, ...changes } = parsed.data;
  await audit({
    actorId: authenticatedUser(session).id,
    action: "admin.integrations.opus.update",
    target: "conversation.opus",
    diff: { ...changes, apiKeyChanged: apiKey !== undefined },
    request,
  });
  return ok(await getOpusStatus(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
