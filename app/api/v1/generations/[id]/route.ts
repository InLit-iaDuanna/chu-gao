import { ok } from "@/lib/api-response";
import { requireV1Auth, v1AuthErrorResponse } from "@/lib/v1-auth";
import {
  agentImageErrorResponse,
  ownedAgentGeneration,
} from "@/lib/agent-images";
import { serializeWithInlineImages } from "@/lib/api-generation-result";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireV1Auth(request);
    const row = await ownedAgentGeneration(
      {
        user: principal.user,
        agentAuthorizationId: principal.agentAuthorizationId ?? undefined,
        apiKeyId: principal.apiKeyId ?? undefined,
      },
      (await context.params).id,
    );
    return ok(await serializeWithInlineImages(row), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (
      (error as { code?: string })?.code === "UNAUTHORIZED" ||
      (error as { status?: number })?.status === 401
    ) {
      return v1AuthErrorResponse(error);
    }
    return agentImageErrorResponse(error);
  }
}
