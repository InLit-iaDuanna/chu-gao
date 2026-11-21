import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getAstraStatus, setAstraConfig } from "@/lib/sol-config";
import { readJsonBodySafe } from "@/lib/request-body";

// Astra shares Sol's gateway and key; only its switch is writable here.
const updateSchema = z
  .object({ enabled: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export async function GET(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  return ok(await getAstraStatus());
}

export async function PATCH(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "Astra 配置参数不合法", { status: 400 });
  await setAstraConfig(parsed.data);
  await audit({
    actorId: authenticatedUser(session).id,
    action: "admin.integrations.astra.update",
    target: "conversation.astra",
    diff: parsed.data,
    request,
  });
  return ok(await getAstraStatus());
}
