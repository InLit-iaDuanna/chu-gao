import { fail, ok } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { getDeepSeekConfig } from "@/lib/ai-config";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";

// 用当前已保存的 DeepSeek 配置做一次最小连通性测试。
export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  const rateLimitFailure = await userActionRateLimitResponse(
    sessionResult.user.id,
    "admin-integration-test",
    process.env.RATE_LIMIT_ADMIN_TEST_PER_MIN,
    5,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const config = await getDeepSeekConfig();

  if (!config.apiKey) {
    return fail("NOT_CONFIGURED", "尚未配置 DeepSeek API Key", { status: 400 });
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      return fail("DEEPSEEK_ERROR", `连接失败（${response.status}）`, {
        status: 502,
        details: { status: response.status, detail },
      });
    }

    return ok({ ok: true, model: config.model });
  } catch (error) {
    return fail(
      "DEEPSEEK_UNREACHABLE",
      "无法连接 DeepSeek，请检查 Base URL / 网络",
      {
        status: 502,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}
