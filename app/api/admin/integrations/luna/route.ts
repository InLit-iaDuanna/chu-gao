import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getLunaStatus, setLunaConfig } from "@/lib/luna-config";
import { readJsonBodySafe } from "@/lib/request-body";

const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    baseUrl: z
      .url()
      .refine((value) => /^https?:\/\//i.test(value))
      .optional(),
    apiKey: z.string().max(400).optional(),
    credits: z.number().min(0).max(1_000_000).multipleOf(0.1).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export async function GET(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  return ok(await getLunaStatus());
}

export async function PATCH(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "Luna 配置参数不合法", { status: 400 });
  await setLunaConfig(parsed.data);
  const { apiKey, ...publicChanges } = parsed.data;
  await audit({
    actorId: authenticatedUser(session).id,
    action: "admin.integrations.luna.update",
    target: "conversation.luna",
    diff: { ...publicChanges, apiKeyChanged: apiKey !== undefined },
    request,
  });
  return ok(await getLunaStatus());
}
