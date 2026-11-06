import { describe, expect, it } from "vitest";

import { applyNotificationReadState } from "./inspiration-notifications";

describe("applyNotificationReadState", () => {
  it("marks only matching synthetic notification keys as read", () => {
    const result = applyNotificationReadState(
      [{ id: "comment:c1", type: "COMMENT" }, { id: "like:p1:u2", type: "LIKE" }],
      [{ notificationKey: "comment:c1", readAt: new Date("2026-08-04T08:00:00.000Z") }],
    );
    expect(result.unreadCount).toBe(1);
    expect(result.items[0]).toMatchObject({ isRead: true, readAt: "2026-08-04T08:00:00.000Z" });
    expect(result.items[1]).toMatchObject({ isRead: false, readAt: null });
  });

  it("ignores stale read rows for notifications no longer in the feed", () => {
    const result = applyNotificationReadState(
      [{ id: "derived:p2" }],
      [{ notificationKey: "comment:deleted", readAt: new Date("2026-08-04T08:00:00.000Z") }],
    );
    expect(result).toMatchObject({ unreadCount: 1, items: [{ id: "derived:p2", isRead: false }] });
  });
});
