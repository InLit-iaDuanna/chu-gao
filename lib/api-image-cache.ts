/**
 * Short-lived, in-memory hand-off of API-key generation results.
 *
 * API-key generations are never written to image storage and never get
 * GeneratedImage rows. The worker parks the bytes in Redis for a few minutes
 * so the web process can return them to the caller, and the first read
 * deletes them. Unread results expire on their own.
 */
import { getRedis } from "@/lib/redis";

const KEY_PREFIX = "apigen:";
export const API_IMAGE_TTL_MS = 10 * 60_000;

export interface EphemeralImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface ApiImagePayload {
  b64_json: string;
  mimeType: string;
  width: number;
  height: number;
}

type StoredMeta = Omit<EphemeralImage, "buffer">[];

const metaKey = (generationId: string) => `${KEY_PREFIX}${generationId}:meta`;
const imageKey = (generationId: string, index: number) =>
  `${KEY_PREFIX}${generationId}:img:${index}`;

export async function stashApiGenerationImages(
  generationId: string,
  images: EphemeralImage[],
): Promise<void> {
  const meta: StoredMeta = images.map(({ mimeType, width, height }) => ({
    mimeType,
    width,
    height,
  }));
  const pipeline = getRedis().multi();
  images.forEach((image, index) => {
    pipeline.set(imageKey(generationId, index), image.buffer, "PX", API_IMAGE_TTL_MS);
  });
  // Meta is written last so a reader never sees it without its images.
  pipeline.set(metaKey(generationId), JSON.stringify(meta), "PX", API_IMAGE_TTL_MS);
  const results = await pipeline.exec();
  const failed = results?.find(([error]) => error);
  if (!results || failed) {
    await discardApiGenerationImages(generationId, images.length);
    throw failed?.[0] ?? new Error("failed to stash API generation images");
  }
}

/**
 * Return the stashed images and delete them. Returns null when they were
 * already taken or have expired.
 */
export async function takeApiGenerationImages(
  generationId: string,
): Promise<ApiImagePayload[] | null> {
  const redis = getRedis();
  // GETDEL makes "first reader wins" atomic across concurrent polls.
  const rawMeta = await redis.getdel(metaKey(generationId));
  if (!rawMeta) return null;

  let meta: StoredMeta;
  try {
    meta = JSON.parse(rawMeta) as StoredMeta;
  } catch {
    return null;
  }

  const buffers = await Promise.all(
    meta.map((_, index) => redis.getBuffer(imageKey(generationId, index))),
  );
  await redis.del(...meta.map((_, index) => imageKey(generationId, index)));

  if (buffers.some((buffer) => !buffer)) return null;
  return meta.map((item, index) => ({
    b64_json: (buffers[index] as Buffer).toString("base64"),
    mimeType: item.mimeType,
    width: item.width,
    height: item.height,
  }));
}

export async function discardApiGenerationImages(
  generationId: string,
  count: number,
): Promise<void> {
  const keys = [
    metaKey(generationId),
    ...Array.from({ length: count }, (_, index) => imageKey(generationId, index)),
  ];
  await getRedis().del(...keys);
}
