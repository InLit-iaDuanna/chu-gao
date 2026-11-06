import path from "node:path";
import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { ResearchError } from "./errors";

const root = path.resolve(
  process.env.PRIVATE_STORAGE_DIR || path.join(process.cwd(), ".data/storage"),
);
const MAX_BYTES = 32 * 1024 * 1024;
export function researchFilePath(key: string) {
  if (!/^research\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(key))
    throw new ResearchError("INVALID_FILE", "研究文件路径不合法");
  return path.join(root, key);
}
export async function writeResearchFile(
  taskId: string,
  filename: string,
  data: Buffer | string,
) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buffer.length > MAX_BYTES)
    throw new ResearchError("FILE_TOO_LARGE", "研究文件超过 32MB 上限");
  const safe = filename.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-150) || "file";
  const key = `research/${taskId}/${randomUUID()}-${safe}`;
  const file = researchFilePath(key);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, buffer, { flag: "wx", mode: 0o600 });
  return {
    key,
    sizeBytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}
export async function readResearchFile(key: string) {
  const file = researchFilePath(key);
  if ((await stat(file)).size > MAX_BYTES)
    throw new ResearchError("FILE_TOO_LARGE", "研究文件超过上限");
  return readFile(file);
}
export async function removeResearchFile(key: string) {
  await unlink(researchFilePath(key)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
export function canonicalResearchUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new ResearchError("INVALID_URL", "只支持公开网页链接");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid|gclid)/.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export async function saveResearchSource(
  taskId: string,
  input: {
    url: string;
    title?: string;
    excerpt?: string;
    content?: string;
    screenshot?: string;
    media?: unknown;
    originUrl?: string;
    failed?: boolean;
    assessment?: unknown;
  },
  executionToken?: string,
) {
  const task = await db.researchTask.findUniqueOrThrow({
    where: { id: taskId },
    select: { projectId: true, status: true },
  });
  if (!["running", "queued"].includes(task.status))
    throw new ResearchError("TASK_STOPPED", "研究任务已经停止", 409);
  const url = canonicalResearchUrl(input.url);
  const sourceKey = createHash("sha256").update(url).digest("hex");
  const contentFile = input.content
    ? await writeResearchFile(
        taskId,
        "source.md",
        input.content.slice(0, 500000),
      )
    : null;
  const screenshot = input.screenshot
    ? await writeResearchFile(
        taskId,
        "page.png",
        Buffer.from(input.screenshot, "base64"),
      )
    : null;
  const data = {
    title: (input.title || new URL(url).hostname).slice(0, 500),
    ...(input.excerpt ? { excerpt: input.excerpt.slice(0, 12000) } : {}),
    ...(contentFile
      ? {
          contentKey: contentFile.key,
          contentHash: contentFile.sha256,
          fetchedAt: new Date(),
          status: "captured",
        }
      : input.failed
        ? { status: "fetch_failed" }
        : {}),
    ...(screenshot ? { screenshotKey: screenshot.key } : {}),
    ...(input.media ? { media: JSON.parse(JSON.stringify(input.media)) } : {}),
    ...(input.assessment
      ? { claims: JSON.parse(JSON.stringify({ assessment: input.assessment })) }
      : {}),
    ...(input.originUrl
      ? { originUrl: canonicalResearchUrl(input.originUrl) }
      : {}),
  };
  try {
    const { evidence, old } = await db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ResearchTask" WHERE "id" = ${taskId} FOR UPDATE`,
      );
      const current = await tx.researchTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      if (
        !["running", "queued"].includes(current.status) ||
        (executionToken && current.executionToken !== executionToken)
      )
        throw new ResearchError("TASK_STOPPED", "研究阶段已经停止", 409);
      const old = await tx.researchEvidence.findUnique({
        where: { taskId_sourceKey: { taskId, sourceKey } },
      });
      // A later failed screenshot/capture must not erase an already retained body.
      if (input.failed && old?.contentKey && !old.purgedAt && !contentFile) {
        delete (data as { status?: string }).status;
      }
      const duplicate = contentFile
        ? await tx.researchEvidence.findFirst({
            where: {
              taskId,
              contentHash: contentFile.sha256,
              sourceKey: { not: sourceKey },
            },
            orderBy: { createdAt: "asc" },
          })
        : null;
      if (duplicate)
        data.originUrl = duplicate.originUrl || duplicate.canonicalUrl;
      const evidence = await tx.researchEvidence.upsert({
        where: { taskId_sourceKey: { taskId, sourceKey } },
        create: {
          taskId,
          projectId: task.projectId,
          sourceKey,
          canonicalUrl: url,
          originalUrl: input.url.slice(0, 2048),
          ...data,
        },
        update: data,
      });
      return { evidence, old };
    });
    for (const key of [
      contentFile && old?.contentKey,
      screenshot && old?.screenshotKey,
    ])
      if (key) await removeResearchFile(key).catch(() => {});
    return evidence;
  } catch (error) {
    const keys = [contentFile?.key, screenshot?.key].filter(
      (key): key is string => Boolean(key),
    );
    // Cross-resource commit uncertainty: do not delete a newly committed source
    // when the database's success acknowledgement was lost.
    try {
      const referenced = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "ResearchTask" WHERE "id" = ${taskId} FOR UPDATE`,
        );
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
      for (const key of keys)
        if (!referenced.has(key)) await removeResearchFile(key).catch(() => {});
    } catch {
      /* Outcome unknown; an orphan is safer than a committed missing file. */
    }
    throw error;
  }
}
