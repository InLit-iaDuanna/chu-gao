import { db } from "@/lib/db";

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
