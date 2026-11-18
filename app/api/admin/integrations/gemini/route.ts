import { fail, ok } from "@/lib/api-response";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  geminiConfigUpdateSchema,
  getGeminiStatus,
  setGeminiConfig,
} from "@/lib/gemini-config";
import { readJsonBodySafe } from "@/lib/request-body";

export async function GET(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  return ok(await getGeminiStatus(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = geminiConfigUpdateSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "Gemini 4 配置参数不合法", { status: 400 });
  await setGeminiConfig(parsed.data);
  const { apiKey, ...changes } = parsed.data;
  await audit({
    actorId: authenticatedUser(session).id,
    action: "admin.integrations.gemini.update",
    target: "conversation.gemini",
    diff: { ...changes, apiKeyChanged: apiKey !== undefined },
    request,
  });
  return ok(await getGeminiStatus(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
