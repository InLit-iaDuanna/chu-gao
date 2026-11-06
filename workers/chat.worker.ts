import { db } from "@/lib/db";
import {
  closeChatRuntimeHealth,
  withChatRuntimeTimeout,
} from "@/lib/chat-runtime-health";
import { startChatWorker } from "@/lib/chat-worker";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";

async function main() {
  await db.$queryRaw`SELECT 1`;
  const stop = startChatWorker();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 20_000);
    try {
      if (!(await stop())) process.exitCode = 1;
    } finally {
      closeChatRuntimeHealth();
      getRedis().disconnect();
      await withChatRuntimeTimeout(() => db.$disconnect(), 3_000).catch(
        () => undefined,
      );
      clearTimeout(deadline);
      process.exit(process.exitCode ?? 0);
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  logger.info("Standalone chat worker started.");
}

void main().catch(async (error) => {
  closeChatRuntimeHealth();
  logger.error(
    { errorName: error instanceof Error ? error.name : "unknown" },
    "Chat worker startup failed.",
  );
  await withChatRuntimeTimeout(() => db.$disconnect(), 3_000).catch(
    () => undefined,
  );
  process.exit(1);
});
