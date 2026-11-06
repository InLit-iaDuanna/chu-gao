import { ok } from "@/lib/api-response";
import { researchAdmin, researchFailure } from "@/lib/research/http";
import { storeResearchAttachment } from "@/lib/research/attachments";
import { ResearchError } from "@/lib/research/errors";
export async function POST(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 21 * 1024 * 1024)
      throw new ResearchError("FILE_TOO_LARGE", "每个文件最多 20MB", 413);
    const form = await request.formData();
    const file = form.get("file");
    const projectId = form.get("projectId");
    if (
      !(file instanceof File) ||
      typeof projectId !== "string" ||
      !/\.(pdf|docx|md|txt|csv|png|jpe?g|webp)$/i.test(file.name)
    )
      throw new ResearchError(
        "INVALID_FILE",
        "支持 PDF、DOCX、Markdown、TXT、CSV 和图片文件",
      );
    const row = await storeResearchAttachment(auth.userId!, projectId, {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return ok({
      key: `attachment:${row.id}`,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
    });
  } catch (error) {
    return researchFailure(error);
  }
}
