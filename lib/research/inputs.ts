import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ResearchTask } from "@prisma/client";
import { db } from "@/lib/db";
import { readResearchAttachments } from "./attachments";
import {
  readResearchFile,
  removeResearchFile,
  writeResearchFile,
  saveResearchSource,
} from "./storage";
import { ResearchError } from "./errors";
import { lockResearchTask } from "./service";
import type { ResearchBriefInput } from "./types";
import type { ResearchConfig } from "./config";

async function discardUnreferencedInputFiles(taskId: string, keys: string[]) {
  if (!keys.length) return;
  let referenced: Set<string | null>;
  try {
    // A rejected COMMIT acknowledgement may still have published these files.
    // The same task lock waits for that transaction before checking references.
    referenced = await db.$transaction(async (tx) => {
      await lockResearchTask(tx, taskId);
      const rows = await tx.researchEvidence.findMany({
        where: {
          taskId,
          OR: [{ contentKey: { in: keys } }, { screenshotKey: { in: keys } }],
        },
        select: { contentKey: true, screenshotKey: true },
      });
      return new Set(
        rows.flatMap((row) => [row.contentKey, row.screenshotKey]),
      );
    });
  } catch {
    return; // Unknown database outcome: retain bytes for reconciliation.
  }
  for (const key of keys)
    if (!referenced.has(key)) await removeResearchFile(key).catch(() => {});
}

export async function prepareResearchInputs(
  task: ResearchTask,
  brief: ResearchBriefInput,
  config: ResearchConfig,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!task.executionToken)
    throw new ResearchError("TASK_STOPPED", "研究任务已经停止", 409);
  for (const url of brief.links) {
    signal.throwIfAborted();
    await saveResearchSource(task.id, { url }, task.executionToken);
  }
  const files = await readResearchAttachments(
    task.projectId,
    brief.attachmentKeys,
  );
  const context: string[] = [];
  for (const file of files) {
    signal.throwIfAborted();
    const key = `attachment:${file.id}`;
    const sourceKey = createHash("sha256")
      .update(`provided:${key}:${file.name}`)
      .digest("hex");
    const existing = await db.researchEvidence.findUnique({
      where: { taskId_sourceKey: { taskId: task.id, sourceKey } },
    });
    if (existing) {
      if (existing.contentKey)
        context.push(
          `用户资料 [${existing.id}] ${file.name}:\n${(await readResearchFile(existing.contentKey)).toString("utf8").slice(0, 12000)}`,
        );
      continue;
    }
    const prepared: string[] = [];
    const retained = new Set<string | null>();
    try {
      let contentKey: string | undefined;
      let screenshotKey: string | undefined;
      let contentHash: string | undefined;
      let excerpt = "用户提供的参考图，尚未进行自动视觉分析。";
      if (/\.(pdf|docx|md|txt|csv)$/i.test(file.name)) {
        const response = await fetch(`${config.crawlUrl}/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, data: file.data }),
          signal,
        });
        if (!response.ok)
          throw new ResearchError(
            "DOCUMENT_EXTRACTION_FAILED",
            `资料 ${file.name} 无法读取，请检查文件格式`,
            502,
          );
        const { text } = await response.json();
        signal.throwIfAborted();
        const saved = await writeResearchFile(
          task.id,
          "provided.md",
          String(text).slice(0, 500000),
        );
        contentKey = saved.key;
        prepared.push(saved.key);
        contentHash = saved.sha256;
        excerpt = String(text).slice(0, 1200);
      } else {
        const image = await sharp(Buffer.from(file.data, "base64"), {
          limitInputPixels: 40000000,
        })
          .rotate()
          .resize({
            width: 1440,
            height: 1440,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer();
        signal.throwIfAborted();
        screenshotKey = (
          await writeResearchFile(task.id, "provided.png", image)
        ).key;
        prepared.push(screenshotKey);
      }
      const evidence = await db.$transaction(async (tx) => {
        await lockResearchTask(tx, task.id);
        const current = await tx.researchTask.findUniqueOrThrow({
          where: { id: task.id },
        });
        if (
          current.status !== "running" ||
          current.executionToken !== task.executionToken
        )
          throw new ResearchError("TASK_STOPPED", "研究任务已经停止", 409);
        signal.throwIfAborted();
        const existing = await tx.researchEvidence.findUnique({
          where: { taskId_sourceKey: { taskId: task.id, sourceKey } },
        });
        signal.throwIfAborted();
        if (existing) return existing;
        const evidence = await tx.researchEvidence.create({
          data: {
            taskId: task.id,
            projectId: task.projectId,
            sourceKey,
            originalUrl: key,
            canonicalUrl: key,
            title: file.name,
            excerpt,
            contentKey,
            screenshotKey,
            contentHash,
            status: "provided",
            fetchedAt: new Date(),
          },
        });
        signal.throwIfAborted();
        return evidence;
      });
      retained.add(evidence.contentKey);
      retained.add(evidence.screenshotKey);
      if (evidence.contentKey)
        context.push(
          `用户资料 [${evidence.id}] ${file.name}:\n${(await readResearchFile(evidence.contentKey)).toString("utf8").slice(0, 12000)}`,
        );
    } finally {
      await discardUnreferencedInputFiles(
        task.id,
        prepared.filter((key) => !retained.has(key)),
      );
    }
  }
  return {
    ...brief,
    selectedContext: [brief.selectedContext, ...context]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 60000),
  };
}
