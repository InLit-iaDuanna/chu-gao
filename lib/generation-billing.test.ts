import { beforeEach, expect, it, vi } from "vitest";
const groupBy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { usageLog: { groupBy } } }));
import { loadGenerationBilling } from "./generation-billing";

beforeEach(() => vi.clearAllMocks());

it("reads actual debits and refunds, independently of quoted prices and image status", async () => {
  groupBy.mockResolvedValue([
    { generationId: "done", action: "generate", _sum: { creditsDelta: -17 } },
    {
      generationId: "partial-refund",
      action: "generate",
      _sum: { creditsDelta: -25 },
    },
    {
      generationId: "partial-refund",
      action: "refund",
      _sum: { creditsDelta: 8 },
    },
    {
      generationId: "refunded",
      action: "generate",
      _sum: { creditsDelta: -14 },
    },
    { generationId: "refunded", action: "refund", _sum: { creditsDelta: 14 } },
    { generationId: "running", action: "generate", _sum: { creditsDelta: -9 } },
    {
      generationId: "refund-pending",
      action: "generate",
      _sum: { creditsDelta: -11 },
    },
  ]);
  const result = await loadGenerationBilling("owner", [
    { id: "done", status: "SUCCEEDED" },
    { id: "partial-refund", status: "SUCCEEDED" },
    { id: "refunded", status: "FAILED" },
    { id: "running", status: "RUNNING" },
    { id: "refund-pending", status: "CANCELED" },
    { id: "missing", status: "SUCCEEDED" },
  ]);
  expect(result.get("done")).toEqual({ state: "charged", chargedCredits: 17 });
  expect(result.get("partial-refund")).toEqual({
    state: "refunded",
    chargedCredits: 17,
    refundedCredits: 8,
  });
  expect(result.get("refunded")).toEqual({
    state: "refunded",
    chargedCredits: 0,
    refundedCredits: 14,
  });
  expect(result.get("running")).toEqual({
    state: "reserved",
    chargedCredits: null,
    reservedCredits: 9,
  });
  expect(result.get("refund-pending")).toEqual({
    state: "refund_pending",
    chargedCredits: null,
    reservedCredits: 11,
  });
  expect(result.get("missing")).toEqual({
    state: "unknown",
    chargedCredits: null,
  });
  expect(groupBy.mock.calls[0][0].where.userId).toBe("owner");
});

it("does not query billing for an empty conversation", async () => {
  expect((await loadGenerationBilling("owner", [])).size).toBe(0);
  expect(groupBy).not.toHaveBeenCalled();
});
