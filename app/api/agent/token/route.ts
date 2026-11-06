import { NextResponse } from "next/server";
import {
  AGENT_CLIENT_ID,
  AgentAuthError,
  agentIpRateLimit,
  exchangeDeviceCode,
} from "@/lib/agent-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await agentIpRateLimit(request, "agent-token", 120);
    const body = new URLSearchParams(await request.text());
    if (body.get("client_id") !== AGENT_CLIENT_ID)
      return NextResponse.json({ error: "invalid_client" }, { status: 400 });
    if (
      body.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code"
    )
      return NextResponse.json(
        { error: "unsupported_grant_type" },
        { status: 400 },
      );
    const code = body.get("device_code") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(code))
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    const result = await exchangeDeviceCode(code);
    return NextResponse.json(result, {
      status: "error" in result ? 400 : 200,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
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
