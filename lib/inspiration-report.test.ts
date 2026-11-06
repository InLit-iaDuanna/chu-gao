import { describe, expect, it } from "vitest";

import { REPORT_REASON_VALUES } from "@/lib/inspiration-report";
import { reportSchema } from "@/lib/inspiration-report-schema";

describe("inspiration reports", () => {
  it("accepts every reason exposed by the report dialog", () => {
    for (const reason of REPORT_REASON_VALUES) {
      expect(reportSchema.safeParse({ reason }).success).toBe(true);
    }
  });

  it("rejects arbitrary reasons and keeps the optional note bounded", () => {
    expect(reportSchema.safeParse({ reason: "DISLIKE" }).success).toBe(false);
    expect(
      reportSchema.safeParse({
        reason: "OTHER",
        note: "x".repeat(2_001),
      }).success,
    ).toBe(false);
    expect(reportSchema.safeParse({ reason: "OTHER" }).success).toBe(true);
  });
});
