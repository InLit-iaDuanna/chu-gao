import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { getClientIp } from "@/lib/network";
import { getRedis } from "@/lib/redis";

export class ConcurrentLimitError extends Error {
  constructor(message = "并发生成任务已达上限") {
    super(message);
    this.name = "ConcurrentLimitError";
  }
}

export class DailyLimitError extends Error {
  constructor(message = "今日生成次数已达上限") {
    super(message);
    this.name = "DailyLimitError";
  }
}

export class LoginRateLimitError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    message = "登录过于频繁，请稍后再试",
  ) {
    super(message);
    this.name = "LoginRateLimitError";
  }
}

const localRateLimitStore = new Map<string, { count: number; expiresAt: number }>();

function loginLimitPerMinute(): number {
  const configured = Number(process.env.RATE_LIMIT_LOGIN_PER_MIN ?? 5);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

function localIncrement(key: string, windowSeconds: number) {
  const now = Date.now();
  const current = localRateLimitStore.get(key);

  if (!current || current.expiresAt <= now) {
    const next = { count: 1, expiresAt: now + windowSeconds * 1000 };
    localRateLimitStore.set(key, next);
    return next;
  }

  current.count += 1;
  localRateLimitStore.set(key, current);
  return current;
}

async function incrementRateLimit(key: string, windowSeconds: number) {
  try {
    const redis = getRedis();

    if (redis.status === "wait") {
      await redis.connect();
    }

    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }

    const ttl = await redis.ttl(key);

    return {
      count,
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  } catch {
    const local = localIncrement(key, windowSeconds);

    return {
      count: local.count,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((local.expiresAt - Date.now()) / 1000),
      ),
    };
  }
}

export async function assertLoginAllowed(
  headers: Headers,
  email: string,
): Promise<void> {
  const limit = loginLimitPerMinute();

  if (limit <= 0) {
    return;
  }

  const identifier = createHash("sha256")
    .update(`${(getClientIp(headers) ?? "unknown").toLowerCase()}|${email.trim().toLowerCase()}`)
    .digest("hex");
  const windowSeconds = 60;
  const { count, retryAfterSeconds } = await incrementRateLimit(
    `ratelimit:login:${identifier}`,
    windowSeconds,
  );

  if (count > limit) {
    throw new LoginRateLimitError(retryAfterSeconds);
  }
}

export async function assertGenerationAllowed(userId: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    return;
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      dailyGenLimit: true,
      concurrentLimit: true,
    },
  });

  if (!user) {
    return;
  }

  const runningCount = await db.generation.count({
    where: {
      userId,
      status: { in: ["PENDING", "RUNNING"] },
    },
  });

  if (runningCount >= user.concurrentLimit) {
    throw new ConcurrentLimitError();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dailyCount = await db.generation.count({
    where: {
      userId,
      createdAt: { gte: today },
      status: { not: "CANCELED" },
    },
  });

  if (dailyCount >= user.dailyGenLimit) {
    throw new DailyLimitError();
  }
}
