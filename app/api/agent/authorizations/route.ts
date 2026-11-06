import { ok } from "@/lib/api-response";
import { agentErrorResponse } from "@/lib/agent-auth";
import { agentBrowserUser } from "@/lib/agent-browser";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const auth = await agentBrowserUser(request);
    if (auth.response) return auth.response;
    const rows = await db.agentAuthorization.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        clientName: true,
        mode: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
        sessionVersion: true,
      },
    });
    return ok(
      rows.map(({ sessionVersion, ...row }) => ({
        ...row,
        status: row.revokedAt
          ? "revoked"
          : sessionVersion !== auth.user.sessionVersion
            ? "invalidated"
            : row.expiresAt.getTime() <= Date.now()
              ? "expired"
              : "active",
      })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
}
