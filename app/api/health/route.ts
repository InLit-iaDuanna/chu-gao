import { fail, ok } from "@/lib/api-response";
import { db } from "@/lib/db";
import { getProviderChannelDisplayNameMap } from "@/lib/provider-channel-config";
import {
  buildProviderChannelsFromAccounts,
} from "@/lib/provider-channels";
import { safeUrlForDiagnostics } from "@/lib/providers/diagnostics";
import { generationQueueStats } from "@/lib/queue";
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

async function checkWorker(): Promise<CheckResult> {
  try {
    const stats = await generationQueueStats();

    return {
      status: stats.workerOnline ? "ok" : "unavailable",
      message: stats.workerOnline
        ? "Generation worker heartbeat is fresh."
        : "Generation worker is not reporting a heartbeat.",
      detail: {
        ...stats,
        hint: stats.workerOnline
          ? undefined
          : "Start the full dev stack with `pnpm dev:all`, or start a worker with `pnpm worker`.",
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      message: "Queue status is not readable.",
      detail: {
        hint: "Start Redis and run `pnpm worker`.",
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
    const [activeProviders, imageProviders, displayNameMap] =
      await Promise.all([
        db.provider.count({
          where: {
            isActive: true,
            health: { not: "DOWN" },
          },
        }),
        db.provider.findMany({
          where: {
            isActive: true,
            health: { not: "DOWN" },
            OR: [
              { modelsSupported: { has: "gpt-image-2" } },
              { modelsSupported: { has: "gemini-3.1-flash-image-preview" } },
              { modelsSupported: { has: "gemini-2.5-flash-image" } },
              { modelsSupported: { has: "gemini-3-pro-image-preview" } },
              { modelsSupported: { has: "gemini-2.5-flash-image-pro" } },
            ],
          },
          select: {
            name: true,
            protocol: true,
            baseUrl: true,
            modelsSupported: true,
            accounts: {
              select: {
                baseUrl: true,
                isActive: true,
                health: true,
                cooldownUntil: true,
              },
            },
          },
        }),
        getProviderChannelDisplayNameMap(),
      ]);
    const providerChannels = buildProviderChannelsFromAccounts(
      imageProviders.flatMap((provider) =>
        provider.accounts.map((account) => ({
          ...account,
          provider: { name: provider.name },
        })),
      ),
      { displayNameMap },
    ).map((channel) => ({
      id: channel.id,
      name: channel.displayName,
      baseUrl: safeUrlForDiagnostics(channel.baseUrl),
      status: channel.availableAccountCount === 0 ? "unavailable" : "ok",
      accountCount: channel.accountCount ?? 0,
      availableAccountCount: channel.availableAccountCount ?? 0,
    }));
    const availableChannelCount = providerChannels.filter(
      (channel) => channel.availableAccountCount > 0,
    ).length;

    if (imageProviders.length === 0 || availableChannelCount === 0) {
      return {
        status: "unavailable",
        message:
          "No active image provider channel is available. Configure providers and accounts.",
        detail: {
          activeProviders,
          supportedModels: [
            "gpt-image-2",
            "gemini-3.1-flash-image-preview",
            "gemini-3-pro-image-preview",
          ],
          imageProviderCount: imageProviders.length,
          providerChannels,
        },
      };
    }

    return {
      status: "ok",
      detail: {
        activeProviders,
        imageProviders: imageProviders.length,
        requiredModelAvailable: true,
        providerChannels,
        endpoints: imageProviders.map((provider) =>
          safeUrlForDiagnostics(provider.baseUrl),
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
  const [database, redis, worker, provider] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkWorker(),
    checkProvider(),
  ]);
  const checks = {
    database,
    redis,
    worker,
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
