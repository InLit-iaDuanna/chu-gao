import IORedis from "ioredis";
import { hostname } from "node:os";
import {
  CHAT_RUNTIME_PROTOCOL_VERSION,
  getChatRuntimeConfig,
} from "@/lib/chat-runtime-config";
import { db } from "@/lib/db";

export const CHAT_WORKER_HEARTBEAT_PREFIX = "chat:worker:heartbeat:";
export const CHAT_WORKER_HEARTBEAT_TTL_SECONDS = 20;
const OPERATION_TIMEOUT_MS = 2_000;
let connection: IORedis | undefined;

export interface ChatWorkerHeartbeat {
  instanceId: string;
  hostname: string;
  pid: number;
  buildId: string;
  protocolVersions: number[];
  updatedAt: string;
  status: "accepting" | "draining";
  running: number;
}

export async function withChatRuntimeTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("chat_runtime_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Do not use the queue's unlimited offline queue for liveness or shutdown.
async function healthRedis() {
  if (!connection) {
    connection = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: OPERATION_TIMEOUT_MS,
        commandTimeout: OPERATION_TIMEOUT_MS,
        retryStrategy: (attempt) => Math.min(attempt * 250, 2_000),
      },
    );
    connection.on("error", () => undefined);
  }
  if (connection.status === "wait") await connection.connect();
  if (connection.status !== "ready")
    throw new Error("chat_health_redis_unavailable");
  return connection;
}

export function chatWorkerHeartbeatKey(instanceId: string) {
  return `${CHAT_WORKER_HEARTBEAT_PREFIX}${instanceId}`;
}

export async function touchChatWorkerHeartbeat(value: ChatWorkerHeartbeat) {
  await withChatRuntimeTimeout(async () => {
    const redis = await healthRedis();
    await redis.set(
      chatWorkerHeartbeatKey(value.instanceId),
      JSON.stringify(value),
      "EX",
      CHAT_WORKER_HEARTBEAT_TTL_SECONDS,
    );
  });
}

export async function removeChatWorkerHeartbeat(instanceId: string) {
  await withChatRuntimeTimeout(async () => {
    const redis = await healthRedis();
    await redis.del(chatWorkerHeartbeatKey(instanceId));
  });
}

export function closeChatRuntimeHealth() {
  connection?.disconnect();
  connection = undefined;
}

export function parseChatWorkerHeartbeat(
  raw: string | null,
  now = Date.now(),
): ChatWorkerHeartbeat | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ChatWorkerHeartbeat;
    const age = now - Date.parse(value.updatedAt);
    if (
      !value.instanceId ||
      !value.hostname ||
      !value.buildId ||
      !Number.isInteger(value.pid) ||
      !Array.isArray(value.protocolVersions) ||
      !value.protocolVersions.every(Number.isInteger) ||
      !["accepting", "draining"].includes(value.status) ||
      !Number.isFinite(age) ||
      age < -5_000 ||
      age >= CHAT_WORKER_HEARTBEAT_TTL_SECONDS * 1_000
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export async function getChatWorkerHealth(
  protocolVersion = CHAT_RUNTIME_PROTOCOL_VERSION,
) {
  try {
    const instances = await withChatRuntimeTimeout(async () => {
      const redis = await healthRedis();
      const keys = new Set<string>();
      const deadline = Date.now() + OPERATION_TIMEOUT_MS;
      let cursor = "0";
      do {
        if (Date.now() >= deadline) throw new Error("chat_health_scan_timeout");
        const page = await redis.scan(
          cursor,
          "MATCH",
          `${CHAT_WORKER_HEARTBEAT_PREFIX}*`,
          "COUNT",
          100,
        );
        cursor = page[0];
        for (const key of page[1]) keys.add(key);
      } while (cursor !== "0" && keys.size < 1_000);
      if (!keys.size) return [];
      return (await redis.mget(...keys)).flatMap((raw) => {
        const value = parseChatWorkerHeartbeat(raw);
        return value ? [value] : [];
      });
    });
    return {
      online: instances.some(
        (value) =>
          value.status === "accepting" &&
          value.protocolVersions.includes(protocolVersion),
      ),
      protocolVersion,
      instances,
    };
  } catch {
    return {
      online: false,
      protocolVersion,
      instances: [] as ChatWorkerHeartbeat[],
    };
  }
}

export async function chatWorkerOnline(
  protocolVersion = CHAT_RUNTIME_PROTOCOL_VERSION,
) {
  return (await getChatWorkerHealth(protocolVersion)).online;
}

export async function localChatWorkerOnline() {
  return (await getChatWorkerHealth()).instances.some(
    (value) =>
      value.hostname === hostname() &&
      value.status === "accepting" &&
      value.protocolVersions.includes(CHAT_RUNTIME_PROTOCOL_VERSION),
  );
}

export async function getChatRuntimeStatus() {
  const config = await getChatRuntimeConfig();
  const health = await getChatWorkerHealth();
  const queued = await db.chatAttempt.count({ where: { status: "queued" } });
  const running = await db.chatAttempt.count({ where: { status: "running" } });
  const reserved = await db.chatAttempt.count({
    where: { billingState: "reserved" },
  });
  const activeConversations = await db.chatTurn.count({
    where: { activeConversationId: { not: null } },
  });
  return {
    config,
    protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
    health,
    outstanding: { queued, running, reserved, activeConversations },
    drained:
      queued === 0 &&
      running === 0 &&
      reserved === 0 &&
      activeConversations === 0,
  };
}
