import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import { fail } from "@/lib/api-response";
import { ChatTurnError } from "@/lib/chat-turns";
import { logger } from "@/lib/logger";
import { ChatRuntimeAdmissionError } from "@/lib/chat-runtime-config";

export async function chatRequestUser(request: Request) {
  const session = await checkSession(request);
  const response = sessionFailureResponse(session);
  return response
    ? { response, userId: null }
    : { response: null, userId: authenticatedUser(session).id };
}

export function chatTurnFailure(error: unknown) {
  if (
    error instanceof ChatTurnError ||
    error instanceof ChatRuntimeAdmissionError
  )
    return fail(error.code, error.message, { status: error.status });
  logger.error(
    { errorName: error instanceof Error ? error.name : "unknown" },
    "Chat task API unavailable.",
  );
  return fail("SERVICE_UNAVAILABLE", "对话任务暂时不可用，请稍后重试", {
    status: 503,
  });
}
