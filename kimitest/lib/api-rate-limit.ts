import { fail } from "@/lib/api-response";
import { checkUserActionRateLimit } from "@/lib/rate-limit";

export async function userActionRateLimitResponse(
  userId: string,
  action: string,
  configuredLimit: string | undefined,
  fallback: number,
): Promise<Response | null> {
  const configured = Number(configuredLimit ?? fallback);
  const limit =
    Number.isFinite(configured) && configured > 0 ? configured : fallback;
  const decision = await checkUserActionRateLimit(userId, action, limit);

  return decision.allowed
    ? null
    : fail(
        "RATE_LIMITED",
        `请求过于频繁，请 ${decision.retryAfterSeconds} 秒后重试`,
        {
          status: 429,
          headers: { "Retry-After": String(decision.retryAfterSeconds) },
        },
      );
}
