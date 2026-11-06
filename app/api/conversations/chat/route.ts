import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { getChatCatalog } from "@/lib/chat-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await checkSession(request);
  if (session.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (session.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  return ok(await getChatCatalog(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

// Cached clients must upgrade before execution; no provider or billing access
// exists in this retired protocol, including requests without conversation IDs.
export async function POST(request: Request) {
  const session = await checkSession(request);
  if (session.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (session.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  return fail(
    "CLIENT_UPGRADE_REQUIRED",
    "对话服务已升级，请刷新页面后继续；这次请求未执行、未扣费",
    { status: 426 },
  );
}
