import { z } from "zod";

import { REPORT_REASON_VALUES } from "@/lib/inspiration-report";

export const reportSchema = z.object({
  reason: z.enum(REPORT_REASON_VALUES),
  note: z.string().trim().max(2_000).optional().nullable(),
  commentId: z.string().cuid().optional().nullable(),
});

export type InspirationReportInput = z.infer<typeof reportSchema>;
