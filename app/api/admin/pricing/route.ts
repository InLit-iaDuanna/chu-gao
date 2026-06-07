import { fail, ok } from "@/lib/api-response";
import { readJsonBodySafe } from "@/lib/request-body";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { listModelsWithPricing } from "@/lib/model-pricing";
import { getConfiguredModel } from "@/lib/models/runtime-config";
import { modelPricingPatchSchema, modelPricingSchema } from "@/lib/validators";

function isSimpleMatrixRule(data: {
  aspectRatio?: string | null;
  outputFormat?: string | null;
  background?: string | null;
  usesReference?: boolean | null;
}) {
  return (
    !data.aspectRatio &&
    !data.outputFormat &&
    !data.background &&
    (data.usesReference === null || data.usesReference === undefined)
  );
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "定价服务未配置数据库", { status: 503 });
  }

  const [models, rules] = await Promise.all([
    listModelsWithPricing(),
    db.modelPricing.findMany({
      orderBy: [
        { modelId: "asc" },
        { priority: "desc" },
        { updatedAt: "desc" },
      ],
    }),
  ]);

  return ok({ models, rules });
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "定价服务未配置数据库", { status: 503 });
  }

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const json = body.data;
  const parsed = modelPricingSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "定价参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  if (!(await getConfiguredModel(parsed.data.modelId))) {
    return fail("VALIDATION_ERROR", "未知模型", { status: 400 });
  }

  const admin = authenticatedUser(sessionResult);
  const existingRule =
    parsed.data.resolution && isSimpleMatrixRule(parsed.data)
      ? await db.modelPricing.findFirst({
          where: {
            modelId: parsed.data.modelId,
            image2Mode: parsed.data.image2Mode ?? null,
            resolution: parsed.data.resolution,
            aspectRatio: null,
            outputFormat: null,
            background: null,
            usesReference: null,
          },
          orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        })
      : null;
  const rule = existingRule
    ? await db.modelPricing.update({
        where: { id: existingRule.id },
        data: {
          ...parsed.data,
          image2Mode: parsed.data.image2Mode ?? null,
          aspectRatio: null,
          outputFormat: null,
          background: null,
          usesReference: null,
          isActive: true,
          updatedBy: admin.id,
        },
      })
    : await db.modelPricing.create({
        data: {
          ...parsed.data,
          image2Mode: parsed.data.image2Mode ?? null,
          updatedBy: admin.id,
        },
      });

  await audit({
    actorId: admin.id,
    action: existingRule ? "admin.pricing.update" : "admin.pricing.create",
    target: rule.id,
    diff: parsed.data,
    request,
  });

  return ok(rule, { status: 201 });
}

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "定价服务未配置数据库", { status: 503 });
  }

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const json = body.data;
  const payload =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  const id = typeof payload.id === "string" ? payload.id : null;

  if (!id) {
    return fail("VALIDATION_ERROR", "缺少定价规则 ID", { status: 400 });
  }

  const data = { ...payload };
  delete data.id;
  const parsed = modelPricingPatchSchema.safeParse(data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "定价参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  if (parsed.data.modelId && !(await getConfiguredModel(parsed.data.modelId))) {
    return fail("VALIDATION_ERROR", "未知模型", { status: 400 });
  }

  const admin = authenticatedUser(sessionResult);
  const rule = await db.modelPricing.update({
    where: { id },
    data: {
      ...parsed.data,
      updatedBy: admin.id,
    },
  });

  await audit({
    actorId: admin.id,
    action: "admin.pricing.update",
    target: id,
    diff: parsed.data,
    request,
  });

  return ok(rule);
}
