import { agentErrorResponse } from "@/lib/agent-auth";
import { agentBrowserUser } from "@/lib/agent-browser";
import { createAgentSkillZip } from "@/lib/agent-skill";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = await agentBrowserUser(request);
    if (auth.response) return auth.response;
    return new Response(Buffer.from(await createAgentSkillZip()), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="chugao-image.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
