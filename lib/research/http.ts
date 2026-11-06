import {
  checkSession,
  adminFailureResponse,
  authenticatedUser,
} from "@/lib/auth";
import { fail } from "@/lib/api-response";
import { readJsonBodySafe } from "@/lib/request-body";
import { ResearchError } from "./errors";
import { z } from "zod";

export async function researchAdmin(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  return failure
    ? { response: failure, userId: null }
    : { response: null, userId: authenticatedUser(session).id };
}
export async function researchBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const body = await readJsonBodySafe(request);
  if (!body.ok) throw new ResearchError("INVALID_BODY", "请求内容无法读取");
  const parsed = schema.safeParse(body.data);
  if (!parsed.success)
    throw new ResearchError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message || "研究设置不合法",
    );
  return parsed.data;
}
export function researchFailure(error: unknown) {
  return error instanceof ResearchError
    ? fail(error.code, error.message, { status: error.status })
    : fail("RESEARCH_UNAVAILABLE", "研究服务暂时不可用，请检查服务状态后重试", {
        status: 503,
      });
}
