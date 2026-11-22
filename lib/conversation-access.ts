// 对话可见性：CLOUD 对话按用户可见；LOCAL 对话只绑定创建它的设备。
// 服务器上用同一个 where 片段拼接查询，保证列表、详情、消息、事件流等
// 用户侧接口对其它设备返回与「不存在」一致的 404。

import type { Prisma } from "@prisma/client";

export type ConversationStorageKind = "CLOUD" | "LOCAL";

/** API / 前端使用的保存位置枚举。 */
export type ConversationStorageView = "cloud" | "local";

export function conversationStorageView(
  storage: ConversationStorageKind,
): ConversationStorageView {
  return storage === "LOCAL" ? "local" : "cloud";
}

export function conversationStorageKind(
  storage: ConversationStorageView,
): ConversationStorageKind {
  return storage === "local" ? "LOCAL" : "CLOUD";
}

/**
 * 用户侧对话查询的可见性片段。deviceId 缺失时只允许 CLOUD，
 * 因此网页端（没有设备会话）永远不会看到任何 LOCAL 对话。
 */
export function conversationVisibilityWhere(
  userId: string,
  deviceId?: string | null,
): Prisma.ConversationWhereInput {
  return {
    userId,
    OR: [
      { storage: "CLOUD" },
      ...(deviceId
        ? [{ storage: "LOCAL" as const, localDeviceId: deviceId }]
        : []),
    ],
  };
}

/**
 * 服务层（chat turn、上下文、生成、清理）使用的归属过滤：
 * - deviceId 为字符串或 null（网页会话）：按设备可见性过滤；
 * - deviceId 缺省（worker、管理员、内部调用）：只按用户过滤，不做设备限制。
 */
export function conversationAccessWhere(
  userId: string,
  deviceId?: string | null,
): Prisma.ConversationWhereInput {
  return deviceId === undefined
    ? { userId }
    : conversationVisibilityWhere(userId, deviceId);
}

/** 单条对话是否对当前设备可见（与数据库过滤结果保持一致）。 */
export function conversationVisibleToDevice(
  conversation: {
    userId: string;
    storage: ConversationStorageKind;
    localDeviceId: string | null;
  },
  userId: string,
  deviceId?: string | null,
): boolean {
  if (conversation.userId !== userId) return false;
  if (conversation.storage === "CLOUD") return true;

  return Boolean(deviceId && conversation.localDeviceId === deviceId);
}

type ConversationLookupClient = {
  conversation: {
    findFirst: Prisma.TransactionClient["conversation"]["findFirst"];
  };
};

/**
 * 当前设备能否访问某个对话（只做一次轻量查询）。
 * 聊天任务、上下文压缩等深层服务用它补齐设备维度的归属校验。
 */
export async function conversationAccessibleToDevice(
  client: ConversationLookupClient,
  input: {
    conversationId: string;
    userId: string;
    deviceId?: string | null;
    archivedAt?: null;
  },
): Promise<boolean> {
  const row = await client.conversation.findFirst({
    where: {
      id: input.conversationId,
      ...(input.archivedAt === null ? { archivedAt: null } : {}),
      ...conversationVisibilityWhere(input.userId, input.deviceId),
    },
    select: { id: true },
  });

  return Boolean(row);
}
