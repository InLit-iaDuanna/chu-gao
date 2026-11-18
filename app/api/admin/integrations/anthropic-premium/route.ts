import { fail, ok } from "@/lib/api-response";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  getPremiumAnthropicStatus,
  premiumAnthropicConfigUpdateSchema,
  setPremiumAnthropicConfig,
} from "@/lib/premium-anthropic-config";
import { readJsonBodySafe } from "@/lib/request-body";

export async function GET(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  return ok(await getPremiumAnthropicStatus(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = premiumAnthropicConfigUpdateSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "高价 Claude 配置参数不合法", {
      status: 400,
    });
  await setPremiumAnthropicConfig(parsed.data);
  const { apiKey, ...changes } = parsed.data;
  await audit({
    actorId: authenticatedUser(session).id,
    action: "admin.integrations.anthropic-premium.update",
    target: "conversation.anthropicPremium",
    diff: { ...changes, apiKeyChanged: apiKey !== undefined },
    request,
  });
  return ok(await getPremiumAnthropicStatus(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
