export interface NotificationReadRecord {
  notificationKey: string;
  readAt: Date;
}

export function applyNotificationReadState<T extends { id: string }>(
  items: T[],
  reads: NotificationReadRecord[],
) {
  const readByKey = new Map(reads.map((item) => [item.notificationKey, item.readAt]));
  const merged = items.map((item) => ({
    ...item,
    isRead: readByKey.has(item.id),
    readAt: readByKey.get(item.id)?.toISOString() ?? null,
  }));
  return {
    items: merged,
    unreadCount: merged.filter((item) => !item.isRead).length,
  };
}
