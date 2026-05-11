import { fail, ok } from "@/lib/api-response";
import { db } from "@/lib/db";
import { safeUrlForDiagnostics } from "@/lib/providers/diagnostics";
import { normalizeOpenAIImagesBaseUrl } from "@/lib/providers/openai-images";
import { getRedis } from "@/lib/redis";

type CheckStatus = "ok" | "missing_config" | "unavailable";

interface CheckResult {
  status: CheckStatus;
  message?: string;
  detail?: Record<string, unknown>;
}

const DEV_GUIDE = {
  startInfra: "docker compose up -d postgres redis",
  migrateAndSeed: "pnpm db:push && pnpm db:seed",
  doctor: "pnpm dev:doctor",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function publicErrorSummary(error: unknown): string {
  const message = errorMessage(error);

  if (
    message.includes("Can't reach database server") ||
    message.includes("ECONNREFUSED")
  ) {
    return "database connection failed";
  }

  if (
    message.includes("Stream isn't writeable") ||
    message.includes("Connection is closed")
  ) {
    return "redis connection failed";
  }

  if (
    message.includes("does not exist") ||
    message.includes("has been changed")
  ) {
    return "database schema is not ready";
  }

  return "dependency check failed";
}

function dbErrorHint(error: unknown): string {
  const message = errorMessage(error);

  if (
    message.includes("Can't reach database server") ||
    message.includes("ECONNREFUSED")
  ) {
    return "Start Postgres with `docker compose up -d postgres`, then run `pnpm db:push && pnpm db:seed`.";
  }

  if (
    message.includes("does not exist") ||
    message.includes("has been changed")
  ) {
    return "Apply the Prisma schema with `pnpm db:push`, then run `pnpm db:seed`.";
  }

  return "Check DATABASE_URL, then run `pnpm dev:doctor`.";
}

async function checkDb(): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) {
    return {
      status: "missing_config",
      message: "DATABASE_URL is not set.",
      detail: {
        hint: "Set DATABASE_URL after Postgres is available.",
      },
    };
  }

  try {
    await db.$queryRaw`SELECT 1`;

    return { status: "ok" };
  } catch (error) {
    return {
      status: "unavailable",
      message:
        "Database is not reachable. Start Postgres and run Prisma setup.",
      detail: {
        hint: dbErrorHint(error),
        error: publicErrorSummary(error),
      },
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  try {
    const redis = getRedis();

    if (redis.status === "wait") {
      await redis.connect();
    }

    await redis.ping();

    return { status: "ok" };
  } catch (error) {
    return {
      status: "unavailable",
      message: "Redis is not reachable. Start Redis or check REDIS_URL.",
      detail: {
        hint: "Start Redis with `docker compose up -d redis`, then run `pnpm dev:doctor`.",
        error: publicErrorSummary(error),
      },
    };
  }
}

async function checkProvider(): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) {
    return {
      status: "missing_config",
      message: "Provider check requires DATABASE_URL.",
    };
  }

  try {
    const activeProviders = await db.provider.count({
      where: {
        isActive: true,
        health: { not: "DOWN" },
      },
    });
    const imageProviders = await db.provider.findMany({
      where: {
        isActive: true,
        health: { not: "DOWN" },
        protocol: "OPENAI_IMAGES",
        modelsSupported: {
          has: "gpt-image-2",
        },
      },
      select: {
        baseUrl: true,
      },
    });

    if (imageProviders.length === 0) {
      return {
        status: "unavailable",
        message:
          "No active Images provider supports the required image model. Configure providers and run setup.",
        detail: {
          activeProviders,
          requiredProtocol: "OPENAI_IMAGES",
          requiredModel: "gpt-image-2",
          requiredModelAvailable: false,
        },
      };
    }

    return {
      status: "ok",
      detail: {
        activeProviders,
        imageProviders: imageProviders.length,
        requiredModelAvailable: true,
        endpoints: imageProviders.map((provider) =>
          safeUrlForDiagnostics(
            `${normalizeOpenAIImagesBaseUrl(provider.baseUrl)}/v1/images/generations`,
          ),
        ),
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      message:
        "Provider table is not readable. Run `pnpm db:push && pnpm db:seed`.",
      detail: {
        hint: dbErrorHint(error),
        error: publicErrorSummary(error),
      },
    };
  }
}

export async function GET() {
  const [database, redis, provider] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkProvider(),
  ]);
  const checks = {
    database,
    redis,
    provider,
  };
  const healthy = Object.values(checks).every((check) => check.status === "ok");

  const data = {
    status: healthy ? "ok" : "degraded",
    service: "chugao-studio",
    timestamp: new Date().toISOString(),
    checks,
    devGuide: healthy ? undefined : DEV_GUIDE,
  };

  if (!healthy) {
    return fail("SERVICE_DEGRADED", "服务依赖未全部就绪", {
      status: 503,
      details: data,
    });
  }

  return ok(data);
}
