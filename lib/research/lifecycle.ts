import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { researchVersionTaskIds } from "./versions";

export async function lockResearchFiles(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('chugao-research-files'))`;
}

export function researchExpiry(snapshot: unknown, now = Date.now()) {
  const days =
    (snapshot as { retentionDays?: number } | null)?.retentionDays ?? 30;
  return new Date(now + days * 86400000);
}

export async function expireResearchAssets(
  tx: Prisma.TransactionClient,
  taskId: string,
  expiresAt: Date,
) {
  await tx.researchArtifact.updateMany({
    where: { taskId },
    data: { expiresAt },
  });
  await tx.researchEvidence.updateMany({
    where: { taskId },
    data: { expiresAt },
  });
}

export async function researchFilesProtected(taskId: string) {
  const direct = await db.researchTask.findFirst({
    where: {
      status: { in: ["queued", "running"] },
      OR: [{ id: taskId }, { sourceTaskId: taskId }],
    },
    select: { id: true },
  });
  if (direct) return true;
  const version = await db.researchTask.findUnique({
    where: { id: taskId },
    select: { projectId: true, userId: true },
  });
  if (!version) return false;
  const active = await db.researchTask.findMany({
    where: {
      ...version,
      status: { in: ["queued", "running"] },
      sourceTaskId: { not: null },
    },
  });
  for (const task of active)
    if ((await researchVersionTaskIds(task)).includes(taskId)) return true;
  return false;
}

export async function researchFileExpired(
  taskId: string,
  purgedAt: Date | null,
  expiresAt: Date | null,
) {
  return (
    !!purgedAt ||
    (!!expiresAt &&
      expiresAt <= new Date() &&
      !(await researchFilesProtected(taskId)))
  );
}
