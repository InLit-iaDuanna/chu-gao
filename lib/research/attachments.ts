import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { readPrivateStorageKey } from "@/lib/storage";
import {
  writeResearchFile,
  removeResearchFile,
  readResearchFile,
} from "./storage";
import { ResearchError } from "./errors";

export async function storeResearchAttachment(
  userId: string,
  projectId: string,
  input: {
    filename: string;
    mimeType: string;
    buffer: Buffer;
    sourceKey?: string;
    retentionDays?: number;
  },
) {
  if (
    !(await db.researchProject.findFirst({
      where: { id: projectId, userId, archivedAt: null },
    }))
  )
    throw new ResearchError("NOT_FOUND", "研究项目不存在", 404);
  if (input.buffer.length > 20 * 1024 * 1024)
    throw new ResearchError("FILE_TOO_LARGE", "每个参考文件最多 20MB", 413);
  const sourceKey = input.sourceKey ?? randomUUID();
  const existing = await db.researchAttachment.findUnique({
    where: { projectId_sourceKey: { projectId, sourceKey } },
  });
  if (existing && !existing.purgedAt && existing.expiresAt > new Date())
    return existing;
  const file = await writeResearchFile(projectId, input.filename, input.buffer);
  try {
    return await db.researchAttachment.upsert({
      where: { projectId_sourceKey: { projectId, sourceKey } },
      create: {
        projectId,
        sourceKey,
        filename: input.filename.slice(0, 200),
        mimeType: input.mimeType,
        storageKey: file.key,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        expiresAt: new Date(
          Date.now() + (input.retentionDays ?? 30) * 86400000,
        ),
      },
      update: {
        storageKey: file.key,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        expiresAt: new Date(
          Date.now() + (input.retentionDays ?? 30) * 86400000,
        ),
        purgedAt: null,
      },
    });
  } catch (error) {
    await removeResearchFile(file.key);
    throw error;
  }
}
export async function snapshotResearchAttachments(
  userId: string,
  projectId: string,
  keys: string[],
  retentionDays: number,
) {
  const result: string[] = [];
  let size = 0;
  for (const key of keys) {
    if (key.startsWith("attachment:")) {
      const row = await db.researchAttachment.findFirst({
        where: {
          id: key.slice(11),
          projectId,
          project: { userId },
          purgedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!row)
        throw new ResearchError(
          "INVALID_REFERENCE",
          "研究参考文件不存在或已过期",
          410,
        );
      size += row.sizeBytes;
      result.push(key);
    } else if (key.startsWith("generated:")) {
      const image = await db.generatedImage.findFirst({
        where: { id: key.slice(10), generation: { userId, deletedAt: null } },
      });
      if (!image)
        throw new ResearchError(
          "INVALID_REFERENCE",
          "生成图片不存在或无权使用",
          403,
        );
      const row = await storeResearchAttachment(userId, projectId, {
        filename: `generated-${image.id}.png`,
        mimeType: image.mimeType || "image/png",
        buffer: await readPrivateStorageKey(image.storageKey),
        sourceKey: key,
        retentionDays,
      });
      size += row.sizeBytes;
      result.push(`attachment:${row.id}`);
    } else {
      if (!key.startsWith(`uploads/${userId}/`) || key.includes(".."))
        throw new ResearchError(
          "INVALID_REFERENCE",
          "参考文件不属于当前账户",
          403,
        );
      const buffer = await readPrivateStorageKey(key);
      const filename = key.split("/").pop()!;
      const row = await storeResearchAttachment(userId, projectId, {
        filename,
        mimeType: `image/${filename.endsWith(".jpg") ? "jpeg" : filename.split(".").pop()}`,
        buffer,
        sourceKey: key,
        retentionDays,
      });
      size += row.sizeBytes;
      result.push(`attachment:${row.id}`);
    }
    if (size > 32 * 1024 * 1024)
      throw new ResearchError(
        "REFERENCE_LIMIT",
        "本次研究的参考文件合计最多 32MB",
        413,
      );
  }
  return result;
}
export async function readResearchAttachments(
  projectId: string,
  keys: string[],
) {
  const rows = await db.researchAttachment.findMany({
    where: {
      id: {
        in: keys
          .filter((key) => key.startsWith("attachment:"))
          .map((key) => key.slice(11)),
      },
      projectId,
      purgedAt: null,
    },
  });
  const result = [];
  for (const row of rows)
    result.push({
      id: row.id,
      name: row.filename,
      mimeType: row.mimeType,
      data: (await readResearchFile(row.storageKey)).toString("base64"),
    });
  return result;
}
