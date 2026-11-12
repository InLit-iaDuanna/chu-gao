import { fail, ok } from "@/lib/api-response";
import {
  checkSession,
  sessionFailureResponse,
  authenticatedUser,
} from "@/lib/auth";
import {
  getStorefrontOrderForUser,
  responseForStorefrontOrder,
  StorefrontOrderError,
} from "@/lib/storefront-orders";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  if (failure) return failure;
  const { id } = await context.params;
  try {
    const order = await getStorefrontOrderForUser(
      id,
      authenticatedUser(sessionResult).id,
    );
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
