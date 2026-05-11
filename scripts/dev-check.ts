import { db } from "@/lib/db";
import { safeUrlForDiagnostics } from "@/lib/providers/diagnostics";
import { normalizeOpenAIImagesBaseUrl } from "@/lib/providers/openai-images";
import { normalizeOpenAIResponsesBaseUrl } from "@/lib/providers/openai-responses-image";
import { getRedis } from "@/lib/redis";
import { existsSync, readFileSync } from "node:fs";

type Status = "ok" | "warn" | "fail";

interface Check {
  name: string;
  status: Status;
  message: string;
}

const checks: Check[] = [];
let databaseReachable = false;

function image2UsesResponses(): boolean {
  return (
    process.env.IMAGE2_WIRE_API?.toLowerCase() === "responses" ||
    process.env.IMAGE2_PROVIDER_PROTOCOL === "OPENAI_RESPONSES_IMAGE" ||
    !process.env.IMAGE2_PROVIDER_PROTOCOL
  );
}

function image2ResponsesEndpoint(): string {
  return `${normalizeOpenAIResponsesBaseUrl(process.env.IMAGE2_BASE_URL ?? "")}/v1/responses`;
}

function image2ImagesEndpoint(): string {
  return `${normalizeOpenAIImagesBaseUrl(process.env.IMAGE2_BASE_URL ?? "")}/v1/images/generations`;
}

function loadDotEnv(): void {
  if (!existsSync(".env")) {
    return;
  }

  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function add(name: string, status: Status, message: string): void {
  checks.push({ name, status, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortError(error: unknown): string {
  const message = errorMessage(error);

  if (message.includes("Can't reach database server")) {
    return "database server is not reachable";
  }

  if (message.includes("ECONNREFUSED")) {
    return "connection refused";
  }

  if (message.includes("Connection is closed")) {
    return "connection is closed";
  }

  return message.replace(/\s+/g, " ").slice(0, 240);
}

function dbHint(error: unknown): string {
  const message = errorMessage(error);

  if (
    message.includes("Can't reach database server") ||
    message.includes("ECONNREFUSED")
  ) {
    return "start Postgres with `docker compose up -d postgres`";
  }

  if (
    message.includes("does not exist") ||
    message.includes("has been changed")
  ) {
    return "apply schema with `pnpm db:push`";
  }

  return "check DATABASE_URL";
}

async function checkEnv(): Promise<void> {
  add(
    "DATABASE_URL",
    process.env.DATABASE_URL ? "ok" : "fail",
    process.env.DATABASE_URL
      ? "configured"
      : "missing; set it in .env",
  );
  add(
    "REDIS_URL",
    process.env.REDIS_URL ? "ok" : "warn",
    process.env.REDIS_URL ? "configured" : "using redis://localhost:6379",
  );
  add(
    "IMAGE2_BASE_URL",
    process.env.IMAGE2_BASE_URL ? "ok" : "fail",
    process.env.IMAGE2_BASE_URL
      ? "configured"
      : "missing; needed before `pnpm db:seed`",
  );
  add(
    "IMAGE2_API_KEY",
    process.env.IMAGE2_API_KEY ? "ok" : "fail",
    process.env.IMAGE2_API_KEY
      ? "configured (hidden)"
      : "missing; needed before `pnpm db:seed`",
  );
  if (process.env.IMAGE2_BASE_URL && image2UsesResponses()) {
    try {
      add(
        "IMAGE2 responses endpoint",
        "ok",
        `${safeUrlForDiagnostics(image2ResponsesEndpoint())} (no /v1/models probe)`,
      );
    } catch (error) {
      add(
        "IMAGE2 responses endpoint",
        "fail",
        `invalid IMAGE2_BASE_URL (${shortError(error)})`,
      );
    }
  }
  if (process.env.IMAGE2_BASE_URL && !image2UsesResponses()) {
    try {
      add(
        "IMAGE2 images endpoint",
        "ok",
        safeUrlForDiagnostics(image2ImagesEndpoint()),
      );
    } catch (error) {
      add(
        "IMAGE2 images endpoint",
        "fail",
        `invalid IMAGE2_BASE_URL (${shortError(error)})`,
      );
    }
  }
  add(
    "IMAGE2 wire API",
    "ok",
    image2UsesResponses()
      ? "OPENAI_RESPONSES_IMAGE via POST /v1/responses"
      : "OPENAI_IMAGES via POST /v1/images/generations",
  );
}

async function checkDb(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    add(
      "db",
      "fail",
      "DATABASE_URL is missing",
    );
    return;
  }

  try {
    await db.$queryRaw`SELECT 1`;
    databaseReachable = true;
    add("db", "ok", "reachable");
  } catch (error) {
    add(
      "db",
      "fail",
      `unreachable: ${dbHint(error)} (${shortError(error)})`,
    );
  }
}

async function checkRedis(): Promise<void> {
  try {
    const redis = getRedis();

    if (redis.status === "wait") {
      await redis.connect();
    }

    await redis.ping();
    add("redis", "ok", "reachable");
  } catch (error) {
    add(
      "redis",
      "fail",
      `unreachable: start Redis with \`docker compose up -d redis\` or check REDIS_URL (${shortError(error)})`,
    );
  }
}

async function checkProviderSeed(): Promise<void> {
  const expectedProtocol = image2UsesResponses()
    ? "OPENAI_RESPONSES_IMAGE"
    : "OPENAI_IMAGES";
  const expectedModel = image2UsesResponses() ? "sub2api-image" : "gpt-image-2";
  const providerCheckName = `provider:${expectedModel}`;

  if (!process.env.DATABASE_URL) {
    add(
      providerCheckName,
      "fail",
      "DATABASE_URL is missing",
    );
    return;
  }

  if (!databaseReachable) {
    add(
      providerCheckName,
      "fail",
      "skipped because database is unreachable; start Postgres, then run `pnpm db:push && pnpm db:seed`",
    );
    return;
  }

  try {
    const providers = await db.provider.findMany({
      where: {
        isActive: true,
        health: { not: "DOWN" },
        protocol: expectedProtocol,
        modelsSupported: {
          has: expectedModel,
        },
      },
      select: {
        name: true,
        protocol: true,
        baseUrl: true,
        health: true,
      },
    });

    if (providers.length === 0) {
      add(
        providerCheckName,
        "fail",
        `no active provider supports ${expectedModel}; run \`pnpm db:seed\``,
      );
      return;
    }

    add(
      providerCheckName,
      "ok",
      providers
        .map(
          (provider) =>
            `${provider.name} ${provider.protocol} ${provider.health} ${safeUrlForDiagnostics(provider.baseUrl)}`,
        )
        .join("; "),
    );
  } catch (error) {
    add(
      providerCheckName,
      "fail",
      `provider table unreadable: ${dbHint(error)} (${shortError(error)})`,
    );
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  await checkEnv();
  await Promise.all([checkDb(), checkRedis()]);
  await checkProviderSeed();

  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(4);
    console.log(`${label} ${check.name}: ${check.message}`);
  }

  if (checks.some((check) => check.status === "fail")) {
    console.log("\nNext steps:");
    console.log(
      "1. Start local dependencies: docker compose up -d postgres redis",
    );
    console.log("2. Apply schema: pnpm db:push");
    console.log("3. Seed image2 provider: pnpm db:seed");
    console.log("4. Start the worker: pnpm worker");
    process.exitCode = 1;
  }

  await db.$disconnect();
  getRedis().disconnect();
}

main().catch(async (error) => {
  console.error(errorMessage(error));
  await db.$disconnect();
  getRedis().disconnect();
  process.exitCode = 1;
});
