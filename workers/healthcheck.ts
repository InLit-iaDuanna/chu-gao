import IORedis from "ioredis";
import {
  closeChatRuntimeHealth,
  localChatWorkerOnline,
  withChatRuntimeTimeout,
} from "@/lib/chat-runtime-health";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  enableOfflineQueue: false,
  connectTimeout: 2_000,
  commandTimeout: 2_000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on("error", () => undefined);
async function main() {
  try {
    const healthy = await withChatRuntimeTimeout(async () => {
      await redis.connect();
      const generation = await redis.get("generation:worker:heartbeat");
      return (
        Boolean(generation && Date.now() - Date.parse(generation) < 60_000) &&
        (await localChatWorkerOnline())
      );
    }, 5_000);
    process.exitCode = healthy ? 0 : 1;
  } catch {
    process.exitCode = 1;
  } finally {
    redis.disconnect();
    closeChatRuntimeHealth();
  }
}
void main();
