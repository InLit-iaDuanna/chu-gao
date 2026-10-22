import { fail, ok } from "@/lib/api-response";
import { requireV1Auth, v1AuthErrorResponse } from "@/lib/v1-auth";
import {
  agentImageErrorResponse,
  listAgentGenerations,
  submitAgentGeneration,
} from "@/lib/agent-images";
import { readJsonBodySafe } from "@/lib/request-body";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { getApiKeyRuntimeConfig } from "@/lib/api-key-pricing";
import {
  syncGenerationResponse,
  waitForGeneration,
} from "@/lib/api-generation-result";
export const runtime = "nodejs";
// Synchronous API-key submits hold the request open for up to 180 s.
export const maxDuration = 200;

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function isAuthError(error: unknown) {
  return (
    (error as { code?: string })?.code === "UNAUTHORIZED" ||
    (error as { status?: number })?.status === 401
  );
}

export async function GET(request: Request) {
  try {
    const principal = await requireV1Auth(request);
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIST_LIMIT);
    if (!Number.isInteger(rawLimit) || rawLimit < 1) {
      return fail("UNSUPPORTED_PARAM", "limit 必须是正整数", { status: 400 });
    }
    const result = await listAgentGenerations(
      {
        user: principal.user,
        agentAuthorizationId: principal.agentAuthorizationId ?? undefined,
        apiKeyId: principal.apiKeyId ?? undefined,
      },
      {
        limit: Math.min(rawLimit, MAX_LIST_LIMIT),
        cursor: url.searchParams.get("cursor") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      },
    );
    return ok(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isAuthError(error)) return v1AuthErrorResponse(error);
    return agentImageErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireV1Auth(request);
    // API keys use the admin-configured per-minute limit; agent tokens keep
    // the env-configured limit.
    const limited = principal.apiKeyId
      ? await userActionRateLimitResponse(
          principal.user.id,
          "apikey-submit",
          String((await getApiKeyRuntimeConfig()).rateLimitPerMin),
          20,
        )
      : await userActionRateLimitResponse(
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
    // API-key calls wait for the result and get the images inline, unless the
    // caller opts out with ?wait=false. Agent tokens stay asynchronous.
    const wantsWait = new URL(request.url).searchParams.get("wait") !== "false";
    if (principal.apiKeyId && wantsWait) {
      const row = await waitForGeneration(
        result.generationId,
        principal.user.id,
        request.signal,
      );
      if (row) return syncGenerationResponse(row);
    }
    return ok(
      {
        // `id` is the documented field; `generationId` kept for older clients.
        id: result.generationId,
        generationId: result.generationId,
        status: result.status,
        estimatedCredits: result.estimatedCredits,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isAuthError(error)) return v1AuthErrorResponse(error);
    return agentImageErrorResponse(error);
  }
}
