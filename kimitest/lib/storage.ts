import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import net from "node:net";
import path from "node:path";

import sharp from "sharp";

import type { InternalReferenceImage } from "@/lib/models/types";
import type { GeneratedImageData } from "@/lib/providers/types";

export interface PersistedGeneratedImage {
  storageKey: string;
  thumbnailKey?: string | null;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

export interface PersistedUploadedReferenceImage {
  storageKey: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

const PRIVATE_STORAGE_DIR = process.env.PRIVATE_STORAGE_DIR
  ? path.resolve(process.env.PRIVATE_STORAGE_DIR)
  : path.join(process.cwd(), ".data", "storage");
const GENERATED_PREFIX = "generated";
const UPLOADS_PREFIX = "uploads";
const MAX_IMAGE_DIMENSION = Number(process.env.MAX_IMAGE_DIMENSION ?? 16_384);
const MAX_IMAGE_PIXELS = Number(process.env.MAX_IMAGE_PIXELS ?? 40_000_000);
const MAX_PROVIDER_IMAGE_REDIRECTS = 3;

function providerImageFetchAllowlist(): string[] {
  return (process.env.PROVIDER_IMAGE_FETCH_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function providerImageDownloadLimitBytes(): number {
  const configured = Number(process.env.MAX_PROVIDER_IMAGE_DOWNLOAD_MB ?? 20);
  const sizeMb =
    Number.isFinite(configured) && configured > 0 ? configured : 20;

  return sizeMb * 1024 * 1024;
}

function providerImageDownloadTimeoutMs(): number {
  const configured = Number(
    process.env.PROVIDER_IMAGE_DOWNLOAD_TIMEOUT_MS ?? 30_000,
  );

  return Number.isFinite(configured) && configured > 0 ? configured : 30_000;
}

function hostMatchesAllowlist(hostname: string, entry: string): boolean {
  if (entry.startsWith("*.")) {
    const suffix = entry.slice(1);
    return hostname.endsWith(suffix);
  }

  return hostname === entry;
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map((part) => Number(part));
  const [first, second] = parts;

  if (parts.length !== 4 || first === undefined || second === undefined) {
    return false;
  }

  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];

  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isPrivateAddress(value: string): boolean {
  const version = net.isIP(value);

  if (version === 4) {
    return isPrivateIpv4(value);
  }

  if (version === 6) {
    return isPrivateIpv6(value);
  }

  return false;
}

async function resolveAllowedProviderImageUrl(value: string): Promise<{
  url: URL;
  address: string;
  family: 4 | 6;
}> {
  const url = new URL(value);
  const allowlist = providerImageFetchAllowlist();

  if (url.protocol !== "https:") {
    throw new Error("provider image download requires https");
  }

  if (
    allowlist.length > 0 &&
    !allowlist.some((entry) =>
      hostMatchesAllowlist(url.hostname.toLowerCase(), entry),
    )
  ) {
    throw new Error("provider image host is not allowlisted");
  }

  const addresses = await lookup(url.hostname, { all: true });

  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateAddress(address.address))
  ) {
    throw new Error("provider image host resolves to a private address");
  }

  const selected = addresses[0];
  if (!selected) {
    throw new Error("provider image host could not be resolved");
  }

  return {
    url,
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
  };
}

async function requestProviderImageOnce(
  target: Awaited<ReturnType<typeof resolveAllowedProviderImageUrl>>,
): Promise<{ statusCode: number; location: string | null; buffer: Buffer }> {
  const maxBytes = providerImageDownloadLimitBytes();

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      target.url,
      {
        method: "GET",
        headers: { Accept: "image/*" },
        lookup: (_hostname, _options, callback) =>
          callback(null, target.address, target.family),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location ?? null;

        if (statusCode >= 300 && statusCode < 400) {
          response.resume();
          resolve({ statusCode, location, buffer: Buffer.alloc(0) });
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`图片下载失败: ${statusCode}`));
          return;
        }

        const contentLength = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          response.destroy();
          reject(new Error("provider image download exceeded size limit"));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > maxBytes) {
            response.destroy(
              new Error("provider image download exceeded size limit"),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({ statusCode, location, buffer: Buffer.concat(chunks) });
        });
        response.on("error", reject);
      },
    );

    request.setTimeout(providerImageDownloadTimeoutMs(), () => {
      request.destroy(new Error("provider image download timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchProviderImage(urlValue: string): Promise<Buffer> {
  let currentUrl = urlValue;

  for (
    let redirects = 0;
    redirects <= MAX_PROVIDER_IMAGE_REDIRECTS;
    redirects += 1
  ) {
    const target = await resolveAllowedProviderImageUrl(currentUrl);
    const response = await requestProviderImageOnce(target);

    if (response.statusCode < 300 || response.statusCode >= 400) {
      return response.buffer;
    }

    const location = response.location;
    if (!location || redirects === MAX_PROVIDER_IMAGE_REDIRECTS) {
      throw new Error("provider image redirect is invalid");
    }

    currentUrl = new URL(location, target.url).toString();
  }

  throw new Error("provider image redirect limit exceeded");
}

export function publicUrlForStorageKey(key: string): string {
  if (key.startsWith("http://") || key.startsWith("https://")) {
    return key;
  }

  return `/${key.replace(/^\/+/, "")}`;
}

export function privateImageUrl(generationId: string, imageId: string): string {
  return `/api/generations/${generationId}/images/${imageId}`;
}

export function privateImageThumbnailUrl(
  generationId: string,
  imageId: string,
): string {
  return `/api/generations/${generationId}/images/${imageId}?variant=thumb`;
}

export function normalizeUploadedReferenceKey(key: string): string | null {
  const normalized = key.trim().replace(/^\/+/, "");

  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized) ||
    !normalized.startsWith(`${UPLOADS_PREFIX}/`)
  ) {
    return null;
  }

  return normalized;
}

function normalizeGeneratedReferenceKey(key: string): string | null {
  const normalized = key.trim().replace(/^\/+/, "");

  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized) ||
    !normalized.startsWith(`${GENERATED_PREFIX}/`)
  ) {
    return null;
  }

  return normalized;
}

function resolvePrivateStorageKey(key: string): string {
  const normalized = key.trim().replace(/^\/+/, "");

  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized)
  ) {
    throw new Error("invalid storage key");
  }

  const resolved = path.resolve(PRIVATE_STORAGE_DIR, normalized);
  const privateRoot = path.resolve(PRIVATE_STORAGE_DIR);

  if (
    resolved !== privateRoot &&
    !resolved.startsWith(`${privateRoot}${path.sep}`)
  ) {
    throw new Error("invalid storage key");
  }

  return resolved;
}

export async function readPrivateStorageKey(key: string): Promise<Buffer> {
  return readFile(resolvePrivateStorageKey(key));
}

export async function statPrivateStorageKey(key: string) {
  return stat(resolvePrivateStorageKey(key));
}

export function createPrivateStorageReadStream(
  key: string,
  options?: { start?: number; end?: number },
) {
  return createReadStream(resolvePrivateStorageKey(key), options);
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

function stripDataUrl(value: string): string {
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);

  if (markerIndex === -1) {
    return value;
  }

  return value.slice(markerIndex + marker.length);
}

async function imageToBuffer(image: GeneratedImageData): Promise<Buffer> {
  if (image.b64) {
    return Buffer.from(stripDataUrl(image.b64), "base64");
  }

  if (image.url) {
    return fetchProviderImage(image.url);
  }

  throw new Error("provider response missing image data");
}

function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegSize(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const size = buffer.readUInt16BE(offset + 2);

    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + size;
  }

  return null;
}

function readWebpSize(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunk = buffer.toString("ascii", 12, 16);

  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

function readImageSize(buffer: Buffer): { width: number; height: number } {
  return (
    readPngSize(buffer) ??
    readJpegSize(buffer) ??
    readWebpSize(buffer) ?? { width: 0, height: 0 }
  );
}

function normalizedMimeType(format: string | undefined): string | null {
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return null;
}

async function validateAndNormalizeUploadedImage(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: string;
}> {
  try {
    const input = sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1,
    });
    const metadata = await input.metadata();
    const mimeType = normalizedMimeType(metadata.format);
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (
      !mimeType ||
      mimeType !== declaredMimeType ||
      width <= 0 ||
      height <= 0 ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION ||
      width * height > MAX_IMAGE_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new Error("invalid uploaded image");
    }

    const normalized = input.rotate();
    const output =
      mimeType === "image/png"
        ? await normalized.png().toBuffer({ resolveWithObject: true })
        : mimeType === "image/jpeg"
          ? await normalized.jpeg({ quality: 92 }).toBuffer({
              resolveWithObject: true,
            })
          : await normalized.webp({ quality: 92 }).toBuffer({
              resolveWithObject: true,
            });

    return {
      buffer: output.data,
      width: output.info.width,
      height: output.info.height,
      mimeType,
    };
  } catch {
    throw new Error("invalid uploaded image");
  }
}

async function createThumbnailBuffer(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: 720,
        height: 720,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 72, effort: 4 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function saveGeneratedImage(
  image: GeneratedImageData,
  generationId: string,
  index: number,
  executionToken?: string,
): Promise<PersistedGeneratedImage> {
  const mimeType = image.mimeType || "image/png";
  const buffer = await imageToBuffer(image);
  const dimensions = readImageSize(buffer);
  const ext = extensionForMimeType(mimeType);
  const executionSuffix = executionToken
    ? `-${executionToken.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}`
    : "";
  const storageKey = `${GENERATED_PREFIX}/${generationId}/${index + 1}${executionSuffix}.${ext}`;
  const filePath = resolvePrivateStorageKey(storageKey);
  const thumbnailKey = `${GENERATED_PREFIX}/${generationId}/${index + 1}${executionSuffix}-thumb.webp`;
  const thumbnailPath = resolvePrivateStorageKey(thumbnailKey);

  let thumbnailBuffer: Buffer | null = null;

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    thumbnailBuffer = await createThumbnailBuffer(buffer);

    if (thumbnailBuffer) {
      await mkdir(path.dirname(thumbnailPath), { recursive: true });
      await writeFile(thumbnailPath, thumbnailBuffer);
    }
  } catch (error) {
    await Promise.all(
      [filePath, thumbnailPath].map(async (writtenPath) => {
        try {
          await unlink(writtenPath);
        } catch {
          // Best effort: the path may not have been written yet.
        }
      }),
    );
    throw error;
  }

  return {
    storageKey,
    thumbnailKey: thumbnailBuffer ? thumbnailKey : null,
    width: image.width || dimensions.width,
    height: image.height || dimensions.height,
    sizeBytes: buffer.byteLength,
    mimeType,
  };
}

export async function removePersistedGeneratedImages(
  images: PersistedGeneratedImage[],
): Promise<void> {
  const keys = images.flatMap((image) =>
    image.thumbnailKey
      ? [image.storageKey, image.thumbnailKey]
      : [image.storageKey],
  );

  await Promise.all(
    keys.map(async (key) => {
      try {
        await unlink(resolvePrivateStorageKey(key));
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          throw error;
        }
      }
    }),
  );
}

export async function saveUploadedReferenceImage({
  buffer,
  mimeType,
  userId,
}: {
  buffer: Buffer;
  mimeType: string;
  userId: string;
}): Promise<PersistedUploadedReferenceImage> {
  const normalized = await validateAndNormalizeUploadedImage(buffer, mimeType);
  const ext = extensionForMimeType(normalized.mimeType);
  const storageKey = `${UPLOADS_PREFIX}/${userId}/${Date.now()}-${randomUUID()}.${ext}`;
  const filePath = resolvePrivateStorageKey(storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, normalized.buffer);

  return {
    storageKey,
    width: normalized.width,
    height: normalized.height,
    sizeBytes: normalized.buffer.byteLength,
    mimeType: normalized.mimeType,
  };
}

export async function hydrateReferenceImages(
  images: InternalReferenceImage[] | undefined,
): Promise<InternalReferenceImage[] | undefined> {
  if (!images?.length) {
    return undefined;
  }

  return Promise.all(
    images.map(async (image) => {
      if (image.b64) {
        return image;
      }

      const uploadedKey = normalizeUploadedReferenceKey(image.key);
      const generatedKey = normalizeGeneratedReferenceKey(image.key);

      if (!uploadedKey && !generatedKey) {
        throw new Error("invalid reference image key");
      }

      const buffer = await readPrivateStorageKey(
        (generatedKey ?? uploadedKey) as string,
      );

      return {
        ...image,
        b64: buffer.toString("base64"),
      };
    }),
  );
}
