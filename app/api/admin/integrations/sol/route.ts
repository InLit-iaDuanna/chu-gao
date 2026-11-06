import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getSolStatus, setSolConfig } from "@/lib/sol-config";
import { readJsonBodySafe } from "@/lib/request-body";

const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    baseUrl: z
      .url()
      .refine((value) => /^https:\/\//i.test(value))
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
  return ok(await getSolStatus());
}

export async function PATCH(request: Request) {
  const session = await checkSession(request);
  const failure = adminFailureResponse(session);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "Sol 配置参数不合法", { status: 400 });
  await setSolConfig(parsed.data);
  const { apiKey, ...changes } = parsed.data;
  await audit({
    actorId: authenticatedUser(session).id,
    action: "admin.integrations.sol.update",
    target: "conversation.sol",
    diff: { ...changes, apiKeyChanged: apiKey !== undefined },
    request,
  });
  return ok(await getSolStatus());
}
