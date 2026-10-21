import { ok } from "@/lib/api-response";
import { requireV1Auth, v1AuthErrorResponse } from "@/lib/v1-auth";
import {
  agentImageErrorResponse,
  submitAgentGeneration,
} from "@/lib/agent-images";
import { readJsonBodySafe } from "@/lib/request-body";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const principal = await requireV1Auth(request);
    const limited = await userActionRateLimitResponse(
      principal.user.id,
      "agent-submit",
      process.env.RATE_LIMIT_AGENT_SUBMIT_PER_MIN,
      20,
    );
    if (limited) return limited;
    const body = await readJsonBodySafe(request);
    if (!body.ok) return body.response;
    const result = await submitAgentGeneration(
      {
        user: principal.user,
        agentAuthorizationId: principal.agentAuthorizationId ?? undefined,
        apiKeyId: principal.apiKeyId ?? undefined,
      },
      body.data,
      request.headers.get("idempotency-key"),
      principal.apiKeyId ?? undefined,
    );
    return ok(
      {
        generationId: result.generationId,
        status: result.status,
        estimatedCredits: result.estimatedCredits,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
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
