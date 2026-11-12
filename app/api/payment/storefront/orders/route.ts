import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import { readJsonBodySafe } from "@/lib/request-body";
import {
  createStorefrontOrderForUser,
  StorefrontOrderError,
} from "@/lib/storefront-orders";
import {
  getStorefrontRuntime,
  storefrontOrderResponse,
  storefrontCheckoutResponse,
  storefrontProduct,
} from "@/lib/storefront-payment";
import { storefrontOrderCreateSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  if (failure) return failure;
  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "充值服务未配置数据库", { status: 503 });
  }

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = storefrontOrderCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "充值参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const runtime = getStorefrontRuntime();
  if (!runtime.enabled) {
    return fail("NOT_FOUND", "充值页面暂未开放", { status: 404 });
  }
  const product = storefrontProduct(runtime, parsed.data.credits);
  if (!product) {
    return fail("INVALID_AMOUNT", "当前充值额度暂不可用", { status: 400 });
  }

  const session = authenticatedUser(sessionResult);
  try {
    const { order, queryPassword } = await createStorefrontOrderForUser(
      session.id,
      product,
    );
    return ok(
      {
        order: storefrontOrderResponse(order, "正在通过浏览器创建小铺订单。"),
        checkout: storefrontCheckoutResponse(
          runtime,
          product,
          order.contact,
          queryPassword,
        ),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StorefrontOrderError) {
      return fail(error.code, error.message, {
        status: error.status,
        ...(error.status === 429 ? { headers: { "Retry-After": "60" } } : {}),
      });
    }
    if (error instanceof Error && error.message.includes("ENCRYPTION_KEY")) {
      return fail("SERVICE_UNAVAILABLE", "充值验证服务未配置完成", {
        status: 503,
      });
    }
    throw error;
  }
}
