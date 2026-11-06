import { unzipSync, strFromU8 } from "fflate";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ResearchError, researchJson } from "./errors";
import { writeResearchFile, removeResearchFile } from "./storage";
import { lockResearchTask } from "./service";
import { researchOutputBasis, researchVersionTaskIds } from "./versions";

export function validateResearchArtifact(filename: string, buffer: Buffer) {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (buffer.length > 32 * 1024 * 1024 || !buffer.length)
    throw new ResearchError("INVALID_ARTIFACT", "交付文件为空或超过大小上限");
  if (extension === "pptx" || extension === "docx") {
    const target =
      extension === "pptx" ? "ppt/presentation.xml" : "word/document.xml";
    let files: ReturnType<typeof unzipSync>;
    try {
      files = unzipSync(buffer, {
        filter: (file) =>
          (file.name === target || file.name === "[Content_Types].xml") &&
          file.originalSize < 8 * 1024 * 1024,
      });
    } catch {
      throw new ResearchError(
        "INVALID_ARTIFACT",
        "生成的 Office 文件格式不合法",
      );
    }
    if (
      !files[target] ||
      !files["[Content_Types].xml"] ||
      !strFromU8(files[target]).includes(extension === "pptx" ? "sldId" : "w:")
    )
      throw new ResearchError(
        "INVALID_ARTIFACT",
        "生成文件缺少可编辑的文档内容",
      );
  }
  const mime: Record<string, string> = {
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    html: "text/html; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    json: "application/json; charset=utf-8",
    png: "image/png",
    jpg: "image/jpeg",
    css: "text/css",
    js: "text/javascript",
  };
  if (!extension || !mime[extension])
    throw new ResearchError("UNSUPPORTED_ARTIFACT", "研究文件格式不受支持");
  return mime[extension];
}
export async function saveResearchArtifact(input: {
  taskId: string;
  executionToken: string;
  filename: string;
  title: string;
  kind: string;
  data: string | Buffer;
  evidenceIds?: string[];
}) {
  const buffer = Buffer.isBuffer(input.data)
    ? input.data
    : Buffer.from(input.data);
  const mimeType = validateResearchArtifact(input.filename, buffer);
  const file = await writeResearchFile(input.taskId, input.filename, buffer);
  try {
    const artifact = await db.$transaction(async (tx) => {
      await lockResearchTask(tx, input.taskId);
      const task = await tx.researchTask.findUniqueOrThrow({
        where: { id: input.taskId },
      });
      if (
        task.status !== "running" ||
        task.executionToken !== input.executionToken
      )
        throw new ResearchError("TASK_STOPPED", "研究已经停止", 409);
      const evidence = await tx.researchEvidence.findMany({
        where: {
          taskId: { in: await researchVersionTaskIds(task, tx) },
        },
        select: { id: true },
      });
      const allowed = new Set(evidence.map((row) => row.id));
      const actualIds = [...new Set(input.evidenceIds ?? [])];
      if (actualIds.some((id) => !allowed.has(id)))
        throw new ResearchError(
          "INVALID_EVIDENCE_REFERENCE",
          "产物声明了不属于其研究版本的证据",
          409,
        );
      return tx.researchArtifact.upsert({
        where: {
          taskId_filename: { taskId: task.id, filename: input.filename },
        },
        create: {
          projectId: task.projectId,
          taskId: task.id,
          basisTaskId: researchOutputBasis(task),
          briefId: task.briefId,
          kind: input.kind,
          title: input.title,
          filename: input.filename,
          storageKey: file.key,
          mimeType,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          evidenceIds: researchJson(actualIds),
        },
        update: {},
      });
    });
    if (artifact.storageKey !== file.key) await removeResearchFile(file.key);
    return artifact;
  } catch (error) {
    await discardUnreferencedArtifactFiles(input.taskId, [file.key]);
    throw error;
  }
}

async function discardUnreferencedArtifactFiles(
  taskId: string,
  keys: string[],
) {
  if (!keys.length) return;
  let referenced: Set<string>;
  try {
    // A lost COMMIT acknowledgement does not mean rollback. Re-acquiring this
    // same row lock waits for the earlier transaction's actual outcome.
    referenced = await db.$transaction(async (tx) => {
      await lockResearchTask(tx, taskId);
      const rows = await tx.researchArtifact.findMany({
        where: { taskId, storageKey: { in: keys } },
        select: { storageKey: true },
      });
      return new Set(rows.map((row) => row.storageKey));
    });
  } catch {
    return;
  } // Unknown DB outcome: retain bytes for reconciliation.
  for (const key of keys)
    if (!referenced.has(key)) await removeResearchFile(key).catch(() => {});
}
export function csvResearchTable(rows: Array<Record<string, unknown>>) {
  const columns = [
    "name",
    "kind",
    "status",
    "positioning",
    "price",
    "market",
    "observedAt",
    "observations",
    "evidenceIds",
  ];
  const escape = (value: unknown) => {
    let text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      columns.map(escape).join(","),
      ...rows.map((row) => columns.map((key) => escape(row[key])).join(",")),
    ].join("\r\n")
  );
}

/** Publish a complete validated bundle under one task lock; no half-imported proposal. */
export async function saveResearchArtifactBatch(
  input: {
    taskId: string;
    executionToken: string;
    files: Array<{
      filename: string;
      title: string;
      kind: string;
      data: Buffer;
      evidenceIds: string[];
    }>;
  },
  beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (
    !input.files.length ||
    input.files.length > 8 ||
    new Set(input.files.map((file) => file.filename)).size !==
      input.files.length
  )
    throw new ResearchError(
      "INVALID_ARTIFACT_BUNDLE",
      "文件组为空、重复或超过数量限制",
      409,
    );
  const prepared: Array<{
    input: (typeof input.files)[number];
    file: Awaited<ReturnType<typeof writeResearchFile>>;
    mimeType: string;
  }> = [];
  const retained = new Set<string>();
  try {
    // Validate all formats before beginning any database publication.
    const mimeTypes = input.files.map((file) =>
      validateResearchArtifact(file.filename, file.data),
    );
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      prepared.push({
        input: file,
        mimeType: mimeTypes[i],
        file: await writeResearchFile(input.taskId, file.filename, file.data),
      });
    }
    const artifacts = await db.$transaction(async (tx) => {
      await lockResearchTask(tx, input.taskId);
      const task = await tx.researchTask.findUniqueOrThrow({
        where: { id: input.taskId },
      });
      if (
        task.status !== "running" ||
        task.executionToken !== input.executionToken
      )
        throw new ResearchError(
          "TASK_STOPPED",
          "研究已经停止，文件组未发布",
          409,
        );
      const evidence = await tx.researchEvidence.findMany({
        where: {
          taskId: { in: await researchVersionTaskIds(task, tx) },
        },
        select: { id: true },
      });
      const allowed = new Set(evidence.map((row) => row.id));
      const rows = [];
      for (const item of prepared) {
        const evidenceIds = [...new Set(item.input.evidenceIds)];
        if (evidenceIds.some((id) => !allowed.has(id)))
          throw new ResearchError(
            "INVALID_EVIDENCE_REFERENCE",
            "产物引用越过其研究版本",
            409,
          );
        const previous = await tx.researchArtifact.findUnique({
          where: {
            taskId_filename: { taskId: task.id, filename: item.input.filename },
          },
        });
        if (previous) {
          if (previous.sha256 !== item.file.sha256)
            throw new ResearchError(
              "ARTIFACT_VERSION_CONFLICT",
              "同一尝试的文件内容发生冲突，旧版本已保留",
              409,
            );
          rows.push(previous);
          continue;
        }
        rows.push(
          await tx.researchArtifact.create({
            data: {
              projectId: task.projectId,
              taskId: task.id,
              basisTaskId: researchOutputBasis(task),
              briefId: task.briefId,
              kind: item.input.kind,
              title: item.input.title,
              filename: item.input.filename,
              storageKey: item.file.key,
              mimeType: item.mimeType,
              sizeBytes: item.file.sizeBytes,
              sha256: item.file.sha256,
              evidenceIds: researchJson(evidenceIds),
            },
          }),
        );
      }
      // Internal callers can commit the completed stage/result in the same
      // transaction. Nothing is published if that completion fails.
      await beforeCommit?.(tx);
      return rows;
    });
    artifacts.forEach((row) => retained.add(row.storageKey));
    return artifacts;
  } finally {
    await discardUnreferencedArtifactFiles(
      input.taskId,
      prepared.map((item) => item.file.key).filter((key) => !retained.has(key)),
    );
  }
}

