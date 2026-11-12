import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import { readJsonBodySafe } from "@/lib/request-body";
import {
  responseForStorefrontOrder,
  StorefrontOrderError,
  verifyStorefrontBrowserOrder,
} from "@/lib/storefront-orders";
import { storefrontBrowserVerifySchema } from "@/lib/validators";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  if (failure) return failure;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = storefrontBrowserVerifySchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "小铺订单结果不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }
  const { id } = await context.params;
  const userId = authenticatedUser(sessionResult).id;
  try {
    const result = await verifyStorefrontBrowserOrder(id, userId, {
      tradeNo: parsed.data.trade_no,
      status: parsed.data.status,
      amount: parsed.data.amount,
      goodsKey: parsed.data.goods_key,
      cards: parsed.data.cards,
    });
    return ok(
      {
        ...responseForStorefrontOrder(result.order),
        ...(result.balance === null ? {} : { balance: result.balance }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StorefrontOrderError) {
      return fail(error.code, error.message, { status: error.status });
    }
    throw error;
  }
}
