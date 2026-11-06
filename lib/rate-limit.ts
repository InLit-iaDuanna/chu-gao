import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { getClientIp } from "@/lib/network";
import { getRateLimitRedis } from "@/lib/redis";

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

export class ModerationRejectionLimitError extends Error {
  constructor(message = "违规内容提交过于频繁，请稍后再试") {
    super(message);
    this.name = "ModerationRejectionLimitError";
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

export class RegisterRateLimitError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    message = "注册过于频繁，请稍后再试",
  ) {
    super(message);
    this.name = "RegisterRateLimitError";
  }
}

const localRateLimitStore = new Map<
  string,
  { count: number; expiresAt: number }
>();

type GenerationLimitClient = Pick<
  Prisma.TransactionClient,
  "generation" | "user"
>;

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
    const redis = getRateLimitRedis();

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
    .update(
      `${(getClientIp(headers) ?? "unknown").toLowerCase()}|${email.trim().toLowerCase()}`,
    )
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

function registerLimitPerHour(): number {
  const configured = Number(process.env.RATE_LIMIT_REGISTER_PER_HOUR ?? 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 10;
}

export async function assertRegisterAllowed(headers: Headers): Promise<void> {
  const limit = registerLimitPerHour();

  if (limit <= 0) {
    return;
  }

  const identifier = createHash("sha256")
    .update((getClientIp(headers) ?? "unknown").toLowerCase())
    .digest("hex");
  const windowSeconds = 3600;
  const { count, retryAfterSeconds } = await incrementRateLimit(
    `ratelimit:register:${identifier}`,
    windowSeconds,
  );

  if (count > limit) {
    throw new RegisterRateLimitError(retryAfterSeconds);
  }
}

export async function checkUserActionRateLimit(
  userId: string,
  action: string,
  limitPerMinute: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (!Number.isFinite(limitPerMinute) || limitPerMinute <= 0) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const identifier = createHash("sha256")
    .update(`${userId}|${action}`)
    .digest("hex");
  const { count, retryAfterSeconds } = await incrementRateLimit(
    `ratelimit:user-action:${identifier}`,
    60,
  );

  return {
    allowed: count <= limitPerMinute,
    retryAfterSeconds,
  };
}

export async function assertGenerationAllowedForClient(
  client: GenerationLimitClient,
  userId: string,
): Promise<void> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      dailyGenLimit: true,
      concurrentLimit: true,
    },
  });

  if (!user) {
    return;
  }

  const runningCount = await client.generation.count({
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

  const dailyCount = await client.generation.count({
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

export async function assertGenerationAllowed(userId: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    return;
  }

  await assertGenerationAllowedForClient(db, userId);
}

export async function assertModerationRejectionAllowed(
  userId: string,
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    return;
  }

  const windowMinutes = Number(
    process.env.MODERATION_REJECTION_WINDOW_MINUTES ?? 10,
  );
  const maxRejected = Number(process.env.MODERATION_REJECTION_LIMIT ?? 5);

  if (
    !Number.isFinite(windowMinutes) ||
    !Number.isFinite(maxRejected) ||
    windowMinutes <= 0 ||
    maxRejected <= 0
  ) {
    return;
  }

  const since = new Date(Date.now() - windowMinutes * 60_000);
  const recentRejected = await db.usageLog.count({
    where: {
      userId,
      action: "moderation_rejected",
      createdAt: { gte: since },
    },
  });

  if (recentRejected >= maxRejected) {
    throw new ModerationRejectionLimitError(
      `违规内容提交过于频繁，请 ${windowMinutes} 分钟后再试。`,
    );
  }
}

export async function recordModerationRejectionAttempt(
  userId: string,
  modelId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    return;
  }

  await db.usageLog.create({
    data: {
      userId,
      modelId,
      action: "moderation_rejected",
      creditsDelta: 0,
      metadata: metadata as Prisma.InputJsonObject | undefined,
    },
  });
}
