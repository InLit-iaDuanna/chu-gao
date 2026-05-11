import IORedis from "ioredis";

declare global {
  var __redis__: IORedis | undefined;
}

export class RedisUnavailableError extends Error {
  constructor(
    message = "Redis is unavailable. Start it with `docker compose up -d redis` or set REDIS_URL, then run `pnpm dev:doctor`.",
  ) {
    super(message);
    this.name = "RedisUnavailableError";
  }
}

export function getRedis(): IORedis {
  if (globalThis.__redis__) {
    return globalThis.__redis__;
  }

  const connection = new IORedis(
    process.env.REDIS_URL ?? "redis://localhost:6379",
    {
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 3000),
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: null,
    },
  );
  connection.on("error", () => {
    // Readiness checks convert connection failures into actionable errors.
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__redis__ = connection;
  }

  return connection;
}

export async function assertRedisReady(
  timeoutMs = Number(process.env.REDIS_READY_TIMEOUT_MS ?? 3000),
): Promise<void> {
  const redis = getRedis();

  if (redis.status === "ready") {
    return;
  }

  const waitForReady = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      redis.off("ready", onReady);
      redis.off("error", onError);
      redis.off("end", onEnd);
      redis.off("close", onEnd);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(
        new RedisUnavailableError(
          "Redis connection closed before becoming ready. Start it with `docker compose up -d redis` or check REDIS_URL, then run `pnpm dev:doctor`.",
        ),
      );
    };

    redis.once("ready", onReady);
    redis.once("error", onError);
    redis.once("end", onEnd);
    redis.once("close", onEnd);
  });

  const timeout = new Promise<void>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new RedisUnavailableError(
            "Redis readiness check timed out. Start it with `docker compose up -d redis` or check REDIS_URL, then run `pnpm dev:doctor`.",
          ),
        ),
      timeoutMs,
    );
  });

  if (redis.status === "wait") {
    redis.connect().catch(() => {
      // The connection error is reported through the readiness race below.
    });
  }

  try {
    await Promise.race([waitForReady, timeout]);
  } catch (error) {
    throw error instanceof RedisUnavailableError
      ? error
      : new RedisUnavailableError(
          `${error instanceof Error ? error.message : "Redis is unavailable"}. Start it with \`docker compose up -d redis\` or check REDIS_URL.`,
        );
  }
}
