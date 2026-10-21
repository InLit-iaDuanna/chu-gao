import { ok } from "@/lib/api-response";
import { requireV1Auth, v1AuthErrorResponse } from "@/lib/v1-auth";
export async function GET(request: Request) {
  try {
    const principal = await requireV1Auth(request);
    return ok(
      {
        id: principal.user.id,
        email: principal.user.email,
        credits: principal.user.credits,
        apiKeyId: principal.apiKeyId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return v1AuthErrorResponse(error);
  }
}
