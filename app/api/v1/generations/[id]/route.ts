import { ok } from "@/lib/api-response";
import { requireV1Auth, v1AuthErrorResponse } from "@/lib/v1-auth";
import {
  agentImageErrorResponse,
  ownedAgentGeneration,
  publicAgentFailure,
} from "@/lib/agent-images";
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
    return ok(
      {
        id: row.id,
        modelId: row.modelId,
        status: row.status,
        progress: row.progress,
        costCredits: row.costCredits,
        errorCode: row.errorCode
          ? /MODERATION|CONTENT|SAFETY|UNSAFE/.test(row.errorCode)
            ? "MODERATION_REJECTED"
            : row.status === "CANCELED"
              ? "CANCELED"
              : "GENERATION_FAILED"
          : null,
        errorMessage: publicAgentFailure(row.errorCode),
        images: row.images.map(({ id, width, height, mimeType }) => ({
          id,
          width,
          height,
          mimeType,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
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
