import { fail } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";

// Kept as a deterministic retirement response for old admin clients. No
// request is sent to the removed provider.
export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;
  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }
  return fail("MODEL_RETIRED", "DeepSeek 已下架，请使用 Opus 5.5", {
    status: 410,
  });
}
