import { db } from "@/lib/db";
import type { CreditSettlement } from "@/lib/turn-credit-types";

export async function loadGenerationBilling(
  userId: string,
  generations: Array<{ id: string; status: string }>,
): Promise<Map<string, CreditSettlement>> {
  if (!generations.length) return new Map();
  const entries = await db.usageLog.groupBy({
    by: ["generationId", "action"],
    where: {
      userId,
      generationId: { in: [...new Set(generations.map((item) => item.id))] },
      action: { in: ["generate", "refund"] },
    },
    _sum: { creditsDelta: true },
  });
  return new Map(
    generations.map((generation) => {
      const rows = entries.filter(
        (entry) => entry.generationId === generation.id,
      );
      if (!rows.length)
        return [generation.id, { state: "unknown", chargedCredits: null }];
      const debit = Math.max(
        0,
        -(
          rows.find((row) => row.action === "generate")?._sum.creditsDelta ?? 0
        ),
      );
      const refund = Math.max(
        0,
        rows.find((row) => row.action === "refund")?._sum.creditsDelta ?? 0,
      );
      const net = Number(Math.max(0, debit - refund).toFixed(6));
      const pending = ["PENDING", "RUNNING"].includes(generation.status);
      const refundPending =
        ["FAILED", "CANCELED"].includes(generation.status) && net > 0;
      return [
        generation.id,
        {
          state: pending
            ? "reserved"
            : refundPending
              ? "refund_pending"
              : refund > 0
                ? "refunded"
                : "charged",
          chargedCredits: pending || refundPending ? null : net,
          ...(pending || refundPending ? { reservedCredits: net } : {}),
          ...(refund > 0 ? { refundedCredits: refund } : {}),
        },
      ];
    }),
  );
}
