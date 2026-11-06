import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import {
  agentErrorResponse,
  findDeviceAuthorization,
  decideDeviceAuthorization,
} from "@/lib/agent-auth";
import { agentBrowserUser } from "@/lib/agent-browser";
import { readJsonBodySafe } from "@/lib/request-body";
import { db } from "@/lib/db";

export const runtime = "nodejs";
const decisionSchema = z
  .object({
    userCode: z.string().max(30),
    decision: z.enum(["approve", "deny"]),
    mode: z.enum(["single", "timed"]).optional(),
    durationHours: z.number().int().optional(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const auth = await agentBrowserUser(request);
    if (auth.response) return auth.response;
    const row = await findDeviceAuthorization(
      new URL(request.url).searchParams.get("user_code") ?? "",
    );
    const user = await db.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { email: true, credits: true },
    });
    return ok(
      {
        userCode: new URL(request.url).searchParams.get("user_code"),
        clientName: row.clientName,
        status: row.expiresAt.getTime() <= Date.now() ? "expired" : row.status,
        expiresAt: row.expiresAt,
        account: user,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await agentBrowserUser(request, true);
    if (auth.response) return auth.response;
    const body = await readJsonBodySafe(request);
    if (!body.ok) return body.response;
    const parsed = decisionSchema.safeParse(body.data);
    if (!parsed.success)
      return fail("VALIDATION_ERROR", "授权参数无效", { status: 400 });
    return ok(
      await decideDeviceAuthorization({
        ...parsed.data,
        userId: auth.user.id,
        sessionVersion: auth.user.sessionVersion,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
}
