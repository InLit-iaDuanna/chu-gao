import { ok } from "@/lib/api-response";
import { agentErrorResponse } from "@/lib/agent-auth";
import {
  agentBrowserUser,
  revokeAgentAuthorization,
} from "@/lib/agent-browser";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await agentBrowserUser(request, true);
    if (auth.response) return auth.response;
    return ok(
      await revokeAgentAuthorization(auth.user.id, (await context.params).id),
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
}
