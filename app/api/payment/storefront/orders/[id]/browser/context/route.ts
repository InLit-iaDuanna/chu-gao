import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import {
  getStorefrontOrderForUser,
  readStorefrontQueryPassword,
  StorefrontOrderError,
} from "@/lib/storefront-orders";
import {
  getStorefrontRuntime,
  storefrontCheckoutResponse,
} from "@/lib/storefront-payment";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  if (failure) return failure;
  const { id } = await context.params;
  const userId = authenticatedUser(sessionResult).id;
  try {
    const order = await getStorefrontOrderForUser(id, userId);
    const runtime = getStorefrontRuntime();
    if (!runtime.shopUrl) {
      return fail("STOREFRONT_UNAVAILABLE", "小铺配置暂时不可用", {
        status: 503,
      });
    }
    const password = await readStorefrontQueryPassword(id, userId);
    return ok(
      storefrontCheckoutResponse(
        runtime,
        {
          credits: order.credits,
          goodsKey: order.productId,
          price: Number(order.amount),
        },
        order.contact,
        password,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StorefrontOrderError) {
      return fail(error.code, error.message, { status: error.status });
    }
    throw error;
  }
}
