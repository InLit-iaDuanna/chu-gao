import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import { sameOriginMutationFailure } from "@/lib/request-origin";
import { AgentAuthError } from "@/lib/agent-auth";
import { db } from "@/lib/db";

export async function agentBrowserUser(request: Request, mutation = false) {
  if (mutation) {
    const originRequest =
      process.env.NODE_ENV === "production"
        ? new Request(
            new URL(
              new URL(request.url).pathname,
              `https://${process.env.AUTH_CANONICAL_HOST || "chugao.art"}`,
            ),
            { headers: request.headers },
          )
        : request;
    const failure = sameOriginMutationFailure(originRequest);
    if (failure) return { response: failure } as const;
  }
  const session = await checkSession(request);
  const failure = sessionFailureResponse(session);
  if (failure) return { response: failure } as const;
  return { user: authenticatedUser(session) } as const;
}

export async function revokeAgentAuthorization(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`;
    const result = await tx.agentAuthorization.updateMany({
      where: { id, userId },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new AgentAuthError("NOT_FOUND", "授权不存在", 404);
    return { revoked: true };
  });
}
