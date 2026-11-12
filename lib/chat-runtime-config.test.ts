// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  raw: vi.fn(),
  execute: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    systemConfig: { findUnique: mocks.read },
    $transaction: mocks.transaction,
  },
}));
import {
  assertChatRuntimeAdmission,
  CHAT_TASK_PROTOCOL_VERSION,
  getChatRuntimeAdmission,
  setChatRuntimeConfig,
} from "@/lib/chat-runtime-config";
import {
  SOL_MODEL_ID,
  LUNA_MODEL_ID,
  OPUS_MODEL_ID,
} from "@/lib/chat-model-options";

describe("chat runtime admission", () => {
  const tx = {
    $executeRaw: mocks.execute,
    $queryRaw: mocks.raw,
    systemConfig: { findUniqueOrThrow: mocks.read, update: mocks.update },
  } as unknown as Prisma.TransactionClient;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/test");
    mocks.read.mockResolvedValue(null);
    mocks.raw.mockResolvedValue([]);
    mocks.transaction.mockImplementation((operation) => operation(tx));
  });

  it("defaults to locally usable profiles, v2 and no implicit queue expiry", async () => {
    for (const model of [OPUS_MODEL_ID, SOL_MODEL_ID, LUNA_MODEL_ID])
      expect(await assertChatRuntimeAdmission("user-a", model)).toMatchObject({
        allowed: true,
        protocolVersion: CHAT_TASK_PROTOCOL_VERSION,
        queueTimeoutMs: null,
      });
  });

  it("applies enabled, profile and user gates without reading model settings", async () => {
    mocks.read.mockResolvedValue({
      value: {
        profiles: [SOL_MODEL_ID],
        userAllowlist: ["user-a"],
        queueTimeoutMs: 120_000,
      },
    });
    expect(
      await assertChatRuntimeAdmission("user-a", SOL_MODEL_ID),
    ).toMatchObject({ queueTimeoutMs: 120_000 });
    expect(
      (await getChatRuntimeAdmission("user-b", SOL_MODEL_ID)).allowed,
    ).toBe(false);
    await expect(
      assertChatRuntimeAdmission("user-a", LUNA_MODEL_ID),
    ).rejects.toMatchObject({ code: "CHAT_RUNTIME_NOT_ADMITTED", status: 503 });
    mocks.read.mockResolvedValue({ value: { enabled: false } });
    await expect(
      assertChatRuntimeAdmission("user-a", SOL_MODEL_ID),
    ).rejects.toMatchObject({ code: "CHAT_RUNTIME_PAUSED" });
  });

  it("locks transaction admission FOR SHARE after a conflict-safe default insert", async () => {
    mocks.read.mockResolvedValue({ value: { enabled: false } });
    await expect(
      assertChatRuntimeAdmission("user-a", SOL_MODEL_ID, tx),
    ).rejects.toMatchObject({ code: "CHAT_RUNTIME_PAUSED" });
    expect(mocks.execute.mock.calls[0][0].sql).toContain(
      'ON CONFLICT ("key") DO NOTHING',
    );
    expect(mocks.raw.mock.calls[0][0].sql).toContain("FOR SHARE");
    expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.raw.mock.invocationCallOrder[0],
    );
    expect(mocks.raw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.read.mock.invocationCallOrder[0],
    );
  });

  it("updates only supplied fields under FOR UPDATE", async () => {
    mocks.read.mockResolvedValue({
      value: {
        enabled: true,
        profiles: [SOL_MODEL_ID],
        userAllowlist: ["user-a"],
        queueTimeoutMs: 5_000,
      },
    });
    expect(await setChatRuntimeConfig({ enabled: false }, "admin-a")).toEqual({
      enabled: false,
      profiles: [OPUS_MODEL_ID, SOL_MODEL_ID],
      userAllowlist: ["user-a"],
      queueTimeoutMs: 5_000,
    });
    expect(mocks.raw.mock.calls[0][0].sql).toContain("FOR UPDATE");
    expect(mocks.update.mock.calls[0][0].data.updatedBy).toBe("admin-a");
  });
});
