import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { removeResearchFile } from "./storage";
import { lockResearchFiles } from "./lifecycle";
import { researchVersionTaskIds } from "./versions";

export async function cleanupResearchFiles(now = new Date()) {
  return db.$transaction(
    async (tx) => {
      await lockResearchFiles(tx);
      return cleanup(tx, now);
    },
    { timeout: 60000 },
  );
}

async function cleanup(db: Prisma.TransactionClient, now: Date) {
  const active = await db.researchTask.findMany({
    where: { status: { in: ["queued", "running"] } },
    select: {
      id: true,
      userId: true,
      projectId: true,
      sourceTaskId: true,
      brief: { select: { content: true } },
    },
  });
  const protectedTasks = new Set<string>();
  for (const task of active)
    for (const id of await researchVersionTaskIds(task, db))
      protectedTasks.add(id);
  const briefs = active.map(
    (row) => row.brief.content as { attachmentKeys?: string[] },
  );
  const sourceBriefs = await db.researchTask.findMany({
    where: { id: { in: [...protectedTasks] } },
    select: { brief: { select: { content: true } } },
  });
  briefs.push(
    ...sourceBriefs.map(
      (row) => row.brief.content as { attachmentKeys?: string[] },
    ),
  );
  const protectedAttachments = new Set(
    briefs
      .flatMap((brief) => brief.attachmentKeys ?? [])
      .filter((key) => key.startsWith("attachment:"))
      .map((key) => key.slice(11)),
  );
  let purged = 0;
  const tasks = await db.researchTask.findMany({
    where: {
      id: { notIn: [...protectedTasks] },
      status: { notIn: ["queued", "running"] },
      expiresAt: { lte: now },
    },
    take: 100,
    select: { id: true },
  });
  for (const task of tasks) {
    const artifacts = await db.researchArtifact.findMany({
      where: { taskId: task.id, purgedAt: null },
    });
    const evidence = await db.researchEvidence.findMany({
      where: { taskId: task.id, purgedAt: null },
    });
    for (const row of artifacts) {
      await removeResearchFile(row.storageKey);
      await db.researchArtifact.update({
        where: { id: row.id },
        data: { purgedAt: now },
      });
      purged++;
    }
    for (const row of evidence) {
      for (const key of [row.contentKey, row.screenshotKey])
        if (key) await removeResearchFile(key);
      await db.researchEvidence.update({
        where: { id: row.id },
        data: { purgedAt: now },
      });
      purged++;
    }
  }
  const attachments = await db.researchAttachment.findMany({
    where: {
      id: { notIn: [...protectedAttachments] },
      expiresAt: { lte: now },
      purgedAt: null,
    },
    take: 100,
  });
  for (const row of attachments) {
    await removeResearchFile(row.storageKey);
    await db.researchAttachment.update({
      where: { id: row.id },
      data: { purgedAt: now },
    });
    purged++;
  }
  return { purged };
}
