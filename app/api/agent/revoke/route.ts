import { ok } from "@/lib/api-response";
import { agentErrorResponse, requireAgent } from "@/lib/agent-auth";
import { revokeAgentAuthorization } from "@/lib/agent-browser";

export async function POST(request: Request) {
  try {
    const auth = await requireAgent(request);
    return ok(
      await revokeAgentAuthorization(auth.user.id, auth.authorization.id),
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
}
