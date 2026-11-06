import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chartPoints,
  normalizeDailySeries,
  normalizeHourlySeries,
} from "../DashboardView";
import { adjustAdminUserCredits } from "./api";

describe("administrator credit operation identity", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });
  const success = () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: {
          id: "synthetic",
          email: "synthetic@example.invalid",
          credits: 10.2,
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );

  it("retains the original operation key when the committed response is lost", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Lost ACK"))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetch);
    await expect(
      adjustAdminUserCredits("synthetic", { amount: 0.2, note: "test" }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await expect(
      adjustAdminUserCredits("synthetic", { amount: 0.2, note: "test" }),
    ).resolves.toMatchObject({ credits: 10.2 });
    const bodies = fetch.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0].operationKey).toBe(bodies[1].operationKey);
    expect(sessionStorage.getItem("admin-credit-pending:synthetic")).toBeNull();
  });

  it("refuses a different payload or forced key while a result is unknown", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Lost ACK"));
    vi.stubGlobal("fetch", fetch);
    await adjustAdminUserCredits("synthetic", { amount: 0.2 }).catch(
      () => undefined,
    );
    await expect(
      adjustAdminUserCredits("synthetic", { amount: 0.3 }),
    ).rejects.toMatchObject({ code: "PENDING_ADJUSTMENT" });
    await expect(
      adjustAdminUserCredits("synthetic", {
        amount: 0.2,
        operationKey: "different-operation",
      }),
    ).rejects.toMatchObject({ code: "PENDING_ADJUSTMENT" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not send money operations if their identity cannot be persisted", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await expect(
      adjustAdminUserCredits("synthetic", { amount: 0.2 }),
    ).rejects.toMatchObject({ code: "OPERATION_ID_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("admin dashboard series", () => {
  it("fills missing calendar days with zero-valued points", () => {
    const now = new Date(2026, 9, 30, 12);
    const result = normalizeDailySeries(
      [
        {
          date: "2026-10-29",
          total: 8,
          succeeded: 7,
          failed: 1,
          credits: 16,
        },
      ],
      3,
      now,
    );

    expect(result.map((row) => row.date)).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
    ]);
    expect(result.map((row) => row.total)).toEqual([0, 8, 0]);
    expect(result[0]).toMatchObject({ succeeded: 0, failed: 0, credits: 0 });
  });

  it("fills missing hours without moving existing measurements", () => {
    const now = new Date(2026, 9, 30, 14, 30);
    const result = normalizeHourlySeries(
      [
        {
          hour: new Date(2026, 9, 30, 13).toISOString(),
          total: 7,
          succeeded: 6,
          failed: 1,
        },
      ],
      3,
      now,
    );

    expect(result.map((row) => new Date(row.hour).getHours())).toEqual([
      12, 13, 14,
    ]);
    expect(result.map((row) => row.total)).toEqual([0, 7, 0]);
  });

  it("uses the supplied shared maximum for every chart series", () => {
    const point = chartPoints([5], 100, 100, 20)[0];
    expect(point.y).toBeCloseTo(73);
  });
});
