/**
 * Shared v1 API auth: accepts both Agent Bearer tokens (cg_...) and
 * API keys (cgapi_...). Returns a unified principal with userId and
 * optional apiKeyId for tracking.
 */
import { requireAgent, agentErrorResponse } from "@/lib/agent-auth";
import {
  requireApiKey,
  detectAuthType,
  apiKeyErrorResponse,
} from "@/lib/api-key-auth";
import { fail } from "@/lib/api-response";

export type V1Principal = {
  user: { id: string; email: string; credits: number };
  apiKeyId: string | null;
  agentAuthorizationId: string | null;
};

export async function requireV1Auth(request: Request): Promise<V1Principal> {
  const authType = detectAuthType(request.headers.get("authorization"));

  if (authType === "apikey") {
    const principal = await requireApiKey(request);
    return {
      user: principal.user,
      apiKeyId: principal.apiKey.id,
      agentAuthorizationId: null,
    };
  }

  // Default: try agent token (handles cg_ prefix and unknown/missing)
  const principal = await requireAgent(request);
  return {
    user: principal.user,
    apiKeyId: null,
    agentAuthorizationId: principal.authorization.id,
  };
}

export function v1AuthErrorResponse(error: unknown) {
  if (
    (error as { code?: string })?.code === "UNAUTHORIZED" ||
    (error as { status?: number })?.status === 401
  ) {
    return fail("UNAUTHORIZED", "请提供有效的 Bearer token", { status: 401 });
  }
  return agentErrorResponse(error);
}
