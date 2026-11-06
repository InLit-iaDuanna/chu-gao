import { describe, expect, it } from "vitest";

import {
  adminPostActionError,
  authorPostStatusError,
  dailyQuestionPostStatus,
  normalizeFeaturePostIds,
  parseDailyPromptDay,
} from "@/lib/inspiration-admin";

describe("inspiration admin workflows", () => {
  it("only allows moderation actions for the matching post state", () => {
    expect(adminPostActionError("APPROVE", "PENDING")).toBeNull();
    expect(adminPostActionError("APPROVE", "PUBLISHED")).toBeTruthy();
    expect(adminPostActionError("RESTORE", "HIDDEN")).toBeNull();
    expect(adminPostActionError("RESTORE", "PUBLISHED")).toBeTruthy();
  });

  it("does not let authors restore an admin-hidden post", () => {
    expect(
      authorPostStatusError({
        current: "HIDDEN",
        requested: "PUBLISHED",
        trustTier: "TRUSTED",
      }),
    ).toBeTruthy();
    expect(
      authorPostStatusError({
        current: "DRAFT",
        requested: "PUBLISHED",
        trustTier: "NEW",
      }),
    ).toBeTruthy();
    expect(
      authorPostStatusError({
        current: "DRAFT",
        requested: "PUBLISHED",
        trustTier: "TRUSTED",
      }),
    ).toBeNull();
  });

  it("validates calendar dates and removes duplicate feature ids", () => {
    expect(parseDailyPromptDay("2026-08-04")?.toISOString()).toBe(
      "2026-08-04T00:00:00.000Z",
    );
    expect(parseDailyPromptDay("2026-02-30")).toBeNull();
    expect(normalizeFeaturePostIds(["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("keeps the official question hidden until the daily prompt is published", () => {
    expect(dailyQuestionPostStatus("DRAFT")).toBe("HIDDEN");
    expect(dailyQuestionPostStatus("SCHEDULED")).toBe("HIDDEN");
    expect(dailyQuestionPostStatus("ARCHIVED")).toBe("HIDDEN");
    expect(dailyQuestionPostStatus("PUBLISHED")).toBe("PUBLISHED");
  });
});
