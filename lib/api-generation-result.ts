/**
 * Synchronous result delivery for v1 generations.
 *
 * API-key callers get their images back in the HTTP response; the bytes come
 * from the short-lived Redis hand-off (api-image-cache.ts) and are deleted on
 * first read. Agent-token generations keep their stored images and download
 * URLs, so they are serialized unchanged.
 */
import { fail, ok } from "@/lib/api-response";
import { takeApiGenerationImages } from "@/lib/api-image-cache";
import { serializeAgentGeneration } from "@/lib/agent-images";
import { db } from "@/lib/db";

export const SYNC_WAIT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

type GenerationRow = Parameters<typeof serializeAgentGeneration>[0];

const NO_STORE = { "Cache-Control": "no-store" };

async function loadGeneration(id: string, userId: string) {
  return db.generation.findFirst({
    where: { id, userId },
    include: { images: { orderBy: { createdAt: "asc" } } },
  });
}

/** Poll until the generation finishes, the deadline passes, or the client leaves. */
export async function waitForGeneration(
  id: string,
  userId: string,
  signal: AbortSignal,
  timeoutMs = SYNC_WAIT_MS,
): Promise<GenerationRow | null> {
  const deadline = Date.now() + timeoutMs;
  let row = await loadGeneration(id, userId);
  while (row && !TERMINAL.has(row.status) && Date.now() < deadline && !signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    row = await loadGeneration(id, userId);
  }
  return row;
}

/**
 * Serialize a generation for an API-key caller. A succeeded job carries its
 * images inline exactly once; later reads report `imagesExpired`.
 */
export async function serializeWithInlineImages(row: GenerationRow) {
  const base = serializeAgentGeneration(row);
  if (!row.apiKeyId || row.status !== "SUCCEEDED") return base;
  const images = await takeApiGenerationImages(row.id);
  return { ...base, images: images ?? [], imagesExpired: images === null };
}

/**
 * Build the HTTP response for a synchronous submit:
 * 200 with images on success, 4xx/5xx on failure (credits already refunded),
 * 202 with the task id if it is still running when the wait ends.
 */
export async function syncGenerationResponse(row: GenerationRow) {
  const body = await serializeWithInlineImages(row);
  if (row.status === "SUCCEEDED") {
    return ok(body, { status: 200, headers: NO_STORE });
  }
  if (row.status === "FAILED" || row.status === "CANCELED") {
    const moderated = body.errorCode === "MODERATION_REJECTED";
    return fail(
      body.errorCode ?? "GENERATION_FAILED",
      body.errorMessage ?? "生成失败",
      { status: moderated ? 400 : 502, headers: NO_STORE, details: body },
    );
  }
  return ok(body, { status: 202, headers: NO_STORE });
}
