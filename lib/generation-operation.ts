import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface GenerationOperation {
  id: string;
  requestHash: string;
}
export class GenerationOperationConflictError extends Error {
  constructor() {
    super("这次确认已用于另一份方案，请重新确认");
  }
}
export function generationOperation(
  id: string,
  request: unknown,
): GenerationOperation {
  return {
    id,
    requestHash: createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex"),
  };
}
export async function findGenerationOperation(
  userId: string,
  operation: GenerationOperation,
  client: Pick<Prisma.TransactionClient, "generation"> = db,
) {
  const row = await client.generation.findFirst({
    where: {
      userId,
      paramsRaw: { path: ["_submission", "id"], equals: operation.id },
    },
    select: {
      id: true,
      status: true,
      jobId: true,
      costCredits: true,
      paramsRaw: true,
      pricingSnapshot: true,
    },
  });
  if (!row) return null;
  const params = row.paramsRaw as { _submission?: { requestHash?: string } };
  if (params._submission?.requestHash !== operation.requestHash)
    throw new GenerationOperationConflictError();
  const snapshot = row.pricingSnapshot as { estimatedCredits?: number } | null;
  return {
    generationId: row.id,
    status: row.status,
    jobId: row.jobId,
    estimatedCredits: snapshot?.estimatedCredits ?? row.costCredits,
  };
}
