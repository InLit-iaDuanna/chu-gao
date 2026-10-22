import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import {
  getApiKeyRuntimeConfig,
  setApiKeyRuntimeConfig,
} from "@/lib/api-key-pricing";
import { readJsonBodySafe } from "@/lib/request-body";

const patchSchema = z.object({
  creditMultiplier: z.number().min(0).max(100).optional(),
  rateLimitPerMin: z.number().int().min(1).max(10000).optional(),
});

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;

  return ok(await getApiKeyRuntimeConfig());
}

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;

  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const updated = await setApiKeyRuntimeConfig(parsed.data);

  const admin = authenticatedUser(sessionResult);
  await audit({
    actorId: admin.id,
    action: "admin.apikey.config.update",
    target: "apiKey",
    diff: parsed.data,
    request,
  });

  return ok(updated);
}
