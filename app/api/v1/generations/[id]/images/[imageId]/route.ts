import { ok } from "@/lib/api-response";
import { AgentAuthError } from "@/lib/agent-auth";
import {
  agentImageErrorResponse,
  ownedAgentGeneration,
} from "@/lib/agent-images";
import { readPrivateStorageKey } from "@/lib/storage";
import { requireV1Auth, v1AuthErrorResponse } from "@/lib/v1-auth";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; imageId: string }> },
) {
  try {
    const principal = await requireV1Auth(request);
    const params = await context.params;
    const row = await ownedAgentGeneration(
      {
        user: principal.user,
        agentAuthorizationId: principal.agentAuthorizationId ?? undefined,
        apiKeyId: principal.apiKeyId ?? undefined,
      },
      params.id,
    );
    const image = row.images.find((item) => item.id === params.imageId);
    if (!image)
      throw new AgentAuthError("NOT_FOUND", "图片不存在或已过期", 404);
    let data: Buffer;
    try {
      data = await readPrivateStorageKey(image.storageKey);
    } catch {
      throw new AgentAuthError("NOT_FOUND", "图片不存在或已过期", 404);
    }
    return ok(
      {
        b64_json: data.toString("base64"),
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
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
