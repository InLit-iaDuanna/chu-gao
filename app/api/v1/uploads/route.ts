import { ok } from "@/lib/api-response";
import { AgentAuthError } from "@/lib/agent-auth";
import { agentImageErrorResponse } from "@/lib/agent-images";
import { saveUploadedReferenceImage } from "@/lib/storage";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { requireV1Auth, v1AuthErrorResponse } from "@/lib/v1-auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const principal = await requireV1Auth(request);
    const limited = await userActionRateLimitResponse(
      principal.user.id,
      "upload",
      process.env.RATE_LIMIT_UPLOAD_PER_MIN,
      20,
    );
    if (limited) return limited;
    const limit = Number(process.env.MAX_UPLOAD_SIZE_MB ?? 10) * 1024 * 1024;
    const maxBody = limit + 512 * 1024;
    if (Number(request.headers.get("content-length")) > maxBody)
      throw new AgentAuthError("PAYLOAD_TOO_LARGE", "参考图上传过大", 413);
    const reader = request.body?.getReader();
    if (!reader)
      throw new AgentAuthError("VALIDATION_ERROR", "请选择参考图", 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBody) {
        await reader.cancel();
        throw new AgentAuthError("PAYLOAD_TOO_LARGE", "参考图上传过大", 413);
      }
      chunks.push(value);
    }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(chunks), {
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      throw new AgentAuthError("VALIDATION_ERROR", "参考图上传格式无效", 400);
    }
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    )
      throw new AgentAuthError(
        "VALIDATION_ERROR",
        "参考图仅支持 PNG、JPEG 或 WEBP",
        400,
      );
    if (!file.size || file.size > limit)
      throw new AgentAuthError("PAYLOAD_TOO_LARGE", "参考图大小超过限制", 413);
    const saved = await saveUploadedReferenceImage({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      userId: principal.user.id,
    }).catch(() => {
      throw new AgentAuthError("VALIDATION_ERROR", "参考图不是有效图片", 400);
    });
    return ok({
      key: saved.storageKey,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      width: saved.width,
      height: saved.height,
    });
  } catch (error) {
    if (
      (error as { code?: string })?.code === "UNAUTHORIZED" ||
      (error as { status?: number })?.status === 401
    ) {
      return v1AuthErrorResponse(error);
    }
    return agentImageErrorResponse(error);
  }
}
