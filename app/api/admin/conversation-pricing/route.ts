import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import {
  getConversationPricing,
  setConversationPricing,
} from "@/lib/ai-config";
import { readJsonBodySafe } from "@/lib/request-body";

const pricingSchema = z.object({
  standardCredits: z.number().min(0).max(1_000_000).multipleOf(0.5),
  reasoningCredits: z.number().min(0).max(1_000_000).multipleOf(0.5),
});

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  const body = await readJsonBodySafe(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = pricingSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "对话定价参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  await setConversationPricing(parsed.data);

  const admin = authenticatedUser(sessionResult);
  await audit({
    actorId: admin.id,
    action: "admin.pricing.conversation.update",
    target: "conversation",
    diff: parsed.data,
    request,
  });

  return ok(await getConversationPricing());
}
