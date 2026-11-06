import { fail, ok } from "@/lib/api-response";
import { db } from "@/lib/db";
import { generationQueueStats } from "@/lib/queue";
import { getRedis } from "@/lib/redis";
import {
  chatWorkerOnline,
  withChatRuntimeTimeout,
} from "@/lib/chat-runtime-health";

export const dynamic = "force-dynamic";

async function dependenciesHealthy(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;

  try {
    return await withChatRuntimeTimeout(async () => {
      const redis = getRedis();
      if (redis.status === "wait") await redis.connect();

      const [, , queue, providerCount, chatOnline] = await Promise.all([
        db.$queryRaw`SELECT 1`,
        redis.ping(),
        generationQueueStats(),
        db.providerAccount.count({
          where: {
            isActive: true,
            health: { not: "DOWN" },
            provider: { isActive: true, health: { not: "DOWN" } },
          },
        }),
        chatWorkerOnline(),
      ]);

      return queue.workerOnline && providerCount > 0 && chatOnline;
    }, 5_500);
  } catch {
    return false;
  }
}

export async function GET() {
  const healthy = await dependenciesHealthy();
  const data = {
    status: healthy ? "ok" : "degraded",
    service: "chugao-studio",
    timestamp: new Date().toISOString(),
  };

  return healthy
    ? ok(data)
    : fail("SERVICE_DEGRADED", "服务依赖未全部就绪", {
        status: 503,
        details: data,
      });
}
