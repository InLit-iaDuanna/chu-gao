import { ok } from "@/lib/api-response";
import { requireV1Auth, v1AuthErrorResponse } from "@/lib/v1-auth";
import { agentImageErrorResponse, agentModels } from "@/lib/agent-images";
export async function GET(request: Request) {
  try {
    await requireV1Auth(request);
    return ok(await agentModels(), {
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
