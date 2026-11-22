import { describe, expect, it, vi } from "vitest";

import {
  conversationAccessWhere,
  conversationAccessibleToDevice,
  conversationStorageKind,
  conversationStorageView,
  conversationVisibilityWhere,
  conversationVisibleToDevice,
} from "./conversation-access";

describe("conversationVisibilityWhere", () => {
  it("keeps cloud conversations visible and binds local ones to the device", () => {
    expect(conversationVisibilityWhere("user-1", "device-1")).toEqual({
      userId: "user-1",
      OR: [
        { storage: "CLOUD" },
        { storage: "LOCAL", localDeviceId: "device-1" },
      ],
    });
  });

  it("only allows cloud conversations when no device id is available", () => {
    expect(conversationVisibilityWhere("user-1")).toEqual({
      userId: "user-1",
      OR: [{ storage: "CLOUD" }],
    });
    expect(conversationVisibilityWhere("user-1", null)).toEqual({
      userId: "user-1",
      OR: [{ storage: "CLOUD" }],
    });
  });
});

describe("conversationAccessWhere", () => {
  it("only filters by device for caller-supplied device ids", () => {
    // 缺省：worker / 管理员等内部调用不加设备过滤。
    expect(conversationAccessWhere("user-1")).toEqual({ userId: "user-1" });
    // null：网页会话，只允许云端对话。
    expect(conversationAccessWhere("user-1", null)).toEqual({
      userId: "user-1",
      OR: [{ storage: "CLOUD" }],
    });
    expect(conversationAccessWhere("user-1", "device-1")).toEqual({
      userId: "user-1",
      OR: [
        { storage: "CLOUD" },
        { storage: "LOCAL", localDeviceId: "device-1" },
      ],
    });
  });
});

describe("conversationVisibleToDevice", () => {
  const cloud = {
    userId: "user-1",
    storage: "CLOUD" as const,
    localDeviceId: null,
  };
  const local = {
    userId: "user-1",
    storage: "LOCAL" as const,
    localDeviceId: "device-1",
  };

  it("always allows the owner's cloud conversations", () => {
    expect(conversationVisibleToDevice(cloud, "user-1")).toBe(true);
    expect(conversationVisibleToDevice(cloud, "user-1", "device-9")).toBe(true);
  });

  it("limits local conversations to the bound device", () => {
    expect(conversationVisibleToDevice(local, "user-1", "device-1")).toBe(true);
    expect(conversationVisibleToDevice(local, "user-1", "device-2")).toBe(
      false,
    );
    expect(conversationVisibleToDevice(local, "user-1")).toBe(false);
  });

  it("rejects conversations of another user", () => {
    expect(conversationVisibleToDevice(cloud, "user-2", "device-1")).toBe(
      false,
    );
    expect(conversationVisibleToDevice(local, "user-2", "device-1")).toBe(
      false,
    );
  });
});

describe("storage view mapping", () => {
  it("round-trips the api values", () => {
    expect(conversationStorageView("LOCAL")).toBe("local");
    expect(conversationStorageView("CLOUD")).toBe("cloud");
    expect(conversationStorageKind("local")).toBe("LOCAL");
    expect(conversationStorageKind("cloud")).toBe("CLOUD");
  });
});

describe("conversationAccessibleToDevice", () => {
  it("queries with the visibility filter", async () => {
    const findFirst = vi.fn(async () => ({ id: "conv-1" }));
    const client = { conversation: { findFirst } } as never;

    await expect(
      conversationAccessibleToDevice(client, {
        conversationId: "conv-1",
        userId: "user-1",
        deviceId: "device-1",
      }),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "conv-1",
        userId: "user-1",
        OR: [
          { storage: "CLOUD" },
          { storage: "LOCAL", localDeviceId: "device-1" },
        ],
      },
      select: { id: true },
    });
  });

  it("reports missing conversations as inaccessible", async () => {
    const client = {
      conversation: { findFirst: vi.fn(async () => null) },
    } as never;

    await expect(
      conversationAccessibleToDevice(client, {
        conversationId: "conv-1",
        userId: "user-1",
      }),
    ).resolves.toBe(false);
  });
});
