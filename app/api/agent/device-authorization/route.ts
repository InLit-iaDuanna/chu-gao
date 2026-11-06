import { NextResponse } from "next/server";
import {
  AGENT_CLIENT_ID,
  AgentAuthError,
  agentIpRateLimit,
  createDeviceAuthorization,
} from "@/lib/agent-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await agentIpRateLimit(request, "agent-device", 10);
    const body = new URLSearchParams(await request.text());
    if (body.get("client_id") !== AGENT_CLIENT_ID)
      return NextResponse.json({ error: "invalid_client" }, { status: 400 });
    const clientName =
      (body.get("client_name") ?? "Chugao Skill")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim()
        .slice(0, 100) || "Chugao Skill";
    const result = await createDeviceAuthorization(request, clientName);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AgentAuthError && error.status === 429
            ? "slow_down"
            : "temporarily_unavailable",
      },
      {
        status: error instanceof AgentAuthError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
