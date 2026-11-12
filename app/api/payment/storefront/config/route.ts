import { ok } from "@/lib/api-response";
import { checkSession, sessionFailureResponse } from "@/lib/auth";
import {
  STOREFRONT_CURRENCY,
  STOREFRONT_FEE_RATE,
  getStorefrontRuntime,
} from "@/lib/storefront-payment";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  if (failure) return failure;

  const runtime = getStorefrontRuntime();
  return ok({
    enabled: runtime.enabled,
    fee_rate: STOREFRONT_FEE_RATE,
    currency: STOREFRONT_CURRENCY,
    payment_tip: "支付完成后，系统会在当前浏览器核对小铺订单和充值卡密。",
    products: runtime.products.map((product) => ({
      credits: product.credits,
      price: product.price,
      currency: STOREFRONT_CURRENCY,
    })),
  });
}
