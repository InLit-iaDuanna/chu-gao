import { fail } from "@/lib/api-response";

/** Require browser mutation requests to originate from the exact app origin. */
export function sameOriginMutationFailure(request: Request): Response | null {
  const origin = request.headers.get("origin");
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    return fail("FORBIDDEN", "请求来源不合法", { status: 403 });
  }
  if (!origin || origin !== expected) {
    return fail("FORBIDDEN", "请求来源不合法", { status: 403 });
  }
  return null;
}
