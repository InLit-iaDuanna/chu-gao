import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { listModelsWithPricing } from "@/lib/model-pricing";
import { getModel } from "@/lib/models/registry";
import { modelPricingPatchSchema, modelPricingSchema } from "@/lib/validators";

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
      orderBy: [{ modelId: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
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

  const json = (await request.json()) as unknown;
  const parsed = modelPricingSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "定价参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  if (!getModel(parsed.data.modelId)) {
    return fail("VALIDATION_ERROR", "未知模型", { status: 400 });
  }

  const admin = authenticatedUser(sessionResult);
  const rule = await db.modelPricing.create({
    data: {
      ...parsed.data,
      updatedBy: admin.id,
    },
  });

  await audit({
    actorId: admin.id,
    action: "admin.pricing.create",
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

  const json = (await request.json()) as unknown;
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

  if (parsed.data.modelId && !getModel(parsed.data.modelId)) {
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
