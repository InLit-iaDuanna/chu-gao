import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { resolvePerImageCredits } from "@/lib/credits";
import {
  getApiKeyRuntimeConfig,
  setApiKeyRuntimeConfig,
} from "@/lib/api-key-pricing";
import { getApiPriceTable, setApiPriceTable } from "@/lib/api-pricing";
import {
  getApiDocsMarkdown,
  MAX_DOCS_LENGTH,
  setApiDocsMarkdown,
} from "@/lib/api-docs";
import { listModelsWithPricing } from "@/lib/model-pricing";
import { readJsonBodySafe } from "@/lib/request-body";

const tierPrices = z
  .object({
    "1K": z.number().min(0).max(1_000_000).optional(),
    "2K": z.number().min(0).max(1_000_000).optional(),
    "4K": z.number().min(0).max(1_000_000).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    creditMultiplier: z.number().min(0).max(100).optional(),
    rateLimitPerMin: z.number().int().min(1).max(10000).optional(),
    prices: z.record(z.string().min(1).max(200), tierPrices).optional(),
    docsMarkdown: z.string().max(MAX_DOCS_LENGTH).optional(),
  })
  .strict();

async function loadConfig() {
  const [runtime, prices, docs, models] = await Promise.all([
    getApiKeyRuntimeConfig(),
    getApiPriceTable(),
    getApiDocsMarkdown(),
    listModelsWithPricing(),
  ]);
  return {
    ...runtime,
    prices,
    docsMarkdown: docs.markdown,
    docsIsDefault: docs.isDefault,
    models: models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      resolutions: model.capabilities.resolutions,
      webPrices: Object.fromEntries(
        model.capabilities.resolutions.map((tier) => [
          tier,
          resolvePerImageCredits(model, { resolution: tier, n: 1 }).credits,
        ]),
      ),
    })),
  };
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;

  return ok(await loadConfig());
}

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;

  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const { prices, docsMarkdown, ...runtime } = parsed.data;
  if (Object.keys(runtime).length > 0) await setApiKeyRuntimeConfig(runtime);
  if (prices !== undefined) await setApiPriceTable(prices);
  if (docsMarkdown !== undefined) await setApiDocsMarkdown(docsMarkdown);

  const admin = authenticatedUser(sessionResult);
  await audit({
    actorId: admin.id,
    action: "admin.apikey.config.update",
    target: "apiKey",
    diff: {
      ...runtime,
      ...(prices !== undefined ? { prices } : {}),
      ...(docsMarkdown !== undefined
        ? { docsMarkdown: `${docsMarkdown.length} chars` }
        : {}),
    },
    request,
  });

  return ok(await loadConfig());
}
