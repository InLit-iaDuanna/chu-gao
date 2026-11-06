// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  redis: {
    status: "ready",
    connect: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    scan: vi.fn(),
    mget: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
  },
}));
vi.mock("ioredis", () => ({
  default: vi.fn(function () {
    return mocks.redis;
  }),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
import {
  chatWorkerOnline,
  closeChatRuntimeHealth,
  getChatWorkerHealth,
  parseChatWorkerHeartbeat,
  removeChatWorkerHeartbeat,
  touchChatWorkerHeartbeat,
} from "@/lib/chat-runtime-health";

describe("per-instance chat worker health", () => {
  const heartbeat = (instanceId: string, protocolVersions = [2]) => ({
    instanceId,
    hostname: "fixture-host",
    pid: 123,
    buildId: "fixture-build",
    protocolVersions,
    updatedAt: new Date().toISOString(),
    status: "accepting" as const,
    running: 0,
  });
  const values = new Map<string, string>();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redis.status = "ready";
    values.clear();
    mocks.redis.set.mockImplementation(async (key, value) => {
      values.set(key, value);
      return "OK";
    });
    mocks.redis.del.mockImplementation(async (key) =>
      Number(values.delete(key)),
    );
    mocks.redis.scan.mockImplementation(async () => ["0", [...values.keys()]]);
    mocks.redis.mget.mockImplementation(async (...keys) =>
      keys.map((key) => values.get(key) ?? null),
    );
  });
  afterEach(() => {
    closeChatRuntimeHealth();
    vi.useRealTimers();
  });

  it("keeps another live instance online after removing only the stopping worker key", async () => {
    await touchChatWorkerHeartbeat(heartbeat("instance-a"));
    await touchChatWorkerHeartbeat(heartbeat("instance-b"));
    await removeChatWorkerHeartbeat("instance-a");
    expect(await chatWorkerOnline()).toBe(true);
    expect(
      (await getChatWorkerHealth()).instances.map((value) => value.instanceId),
    ).toEqual(["instance-b"]);
    expect(mocks.redis.del).toHaveBeenCalledExactlyOnceWith(
      "chat:worker:heartbeat:instance-a",
    );
    expect(mocks.redis.set.mock.calls[0].slice(2)).toEqual(["EX", 20]);
  });

  it("does not advertise incompatible or draining workers as claim-compatible", async () => {
    await touchChatWorkerHeartbeat(heartbeat("future", [3]));
    await touchChatWorkerHeartbeat({
      ...heartbeat("draining"),
      status: "draining",
    });
    expect(await chatWorkerOnline()).toBe(false);
    const health = await getChatWorkerHealth();
    expect(health.instances).toHaveLength(2);
    expect(health.instances[0].buildId).toBe("fixture-build");
  });

  it("rejects stale, malformed and legacy global heartbeat payloads", () => {
    expect(parseChatWorkerHeartbeat("2026-10-18T00:00:00Z")).toBeNull();
    expect(parseChatWorkerHeartbeat("{broken}")).toBeNull();
    const now = Date.now();
    expect(
      parseChatWorkerHeartbeat(
        JSON.stringify({
          ...heartbeat("old"),
          updatedAt: new Date(now - 20_001).toISOString(),
        }),
        now,
      ),
    ).toBeNull();
  });

  it("bounds health reads even when Redis connect never resolves", async () => {
    vi.useFakeTimers();
    mocks.redis.status = "wait";
    mocks.redis.connect.mockImplementation(() => new Promise(() => undefined));
    const health = getChatWorkerHealth();
    await vi.advanceTimersByTimeAsync(2_001);
    expect(await health).toMatchObject({ online: false, instances: [] });
  });
});
