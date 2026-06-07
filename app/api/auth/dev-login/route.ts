import { fail, ok } from "@/lib/api-response";
import { devBypassSession, isDevAuthDbBypassEnabled } from "@/lib/auth";
import { attachSessionCookie } from "@/lib/session-cookie";
import { z } from "zod";

const devLoginSchema = z.object({
  account: z.enum(["student", "admin"]).optional(),
});

function requestHasJson(request: Request): boolean {
  return (
    request.headers.get("content-type")?.includes("application/json") ?? false
  );
}

export async function POST(request: Request) {
  if (!isDevAuthDbBypassEnabled()) {
    return fail("DEV_AUTH_DISABLED", "本地开发登录未启用", { status: 404 });
  }

  const json = requestHasJson(request)
    ? ((await request.json()) as unknown)
    : {};
  const parsed = devLoginSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "本地开发登录参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const session = devBypassSession(parsed.data.account);

  if (!session) {
    return fail("DEV_AUTH_DISABLED", "本地开发登录未启用", { status: 404 });
  }

  return attachSessionCookie(
    ok({
      id: session.id,
      email: session.email,
      role: session.role,
      devAuth: true,
    }),
    session,
  );
}
