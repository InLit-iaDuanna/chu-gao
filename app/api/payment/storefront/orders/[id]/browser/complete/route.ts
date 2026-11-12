import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import { readJsonBodySafe } from "@/lib/request-body";
import {
  bindStorefrontBrowserOrder,
  responseForStorefrontOrder,
  StorefrontOrderError,
} from "@/lib/storefront-orders";
import { storefrontBrowserCompleteSchema } from "@/lib/validators";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = storefrontBrowserCompleteSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "小铺订单信息不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const { id } = await context.params;
  const userId = authenticatedUser(sessionResult).id;
  const input = parsed.data;
  try {
    const order = await bindStorefrontBrowserOrder(id, userId, {
      tradeNo: input.trade_no,
      amount: input.amount,
      payUrl: input.pay_url,
    });
    return ok(responseForStorefrontOrder(order), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StorefrontOrderError) {
      return fail(error.code, error.message, { status: error.status });
    }
    throw error;
  }
}
