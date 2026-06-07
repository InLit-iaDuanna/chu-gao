import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import sharp from "sharp";

import { fetchWithTimeout } from "@/lib/http";
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
  const normalized = value.toLowerCase();

  return (
    normalized === "::1" ||
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

async function assertAllowedProviderImageUrl(value: string): Promise<URL> {
  const url = new URL(value);
  const allowlist = providerImageFetchAllowlist();

  if (url.protocol !== "https:") {
    throw new Error("provider image download requires https");
  }

  if (allowlist.length > 0) {
    if (
      !allowlist.some((entry) =>
        hostMatchesAllowlist(url.hostname.toLowerCase(), entry),
      )
    ) {
      throw new Error("provider image host is not allowlisted");
    }

    return url;
  }

  const addresses = await lookup(url.hostname, { all: true });

  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateAddress(address.address))
  ) {
    throw new Error("provider image host resolves to a private address");
  }

  return url;
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
    const url = await assertAllowedProviderImageUrl(image.url);
    const response = await fetchWithTimeout(url, {
      timeoutMs: providerImageDownloadTimeoutMs(),
    });

    if (!response.ok) {
      throw new Error(`图片下载失败: ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    const maxBytes = providerImageDownloadLimitBytes();

    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error("provider image download exceeded size limit");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > maxBytes) {
      throw new Error("provider image download exceeded size limit");
    }

    return buffer;
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
): Promise<PersistedGeneratedImage> {
  const mimeType = image.mimeType || "image/png";
  const buffer = await imageToBuffer(image);
  const dimensions = readImageSize(buffer);
  const ext = extensionForMimeType(mimeType);
  const storageKey = `${GENERATED_PREFIX}/${generationId}/${index + 1}.${ext}`;
  const filePath = resolvePrivateStorageKey(storageKey);
  const thumbnailKey = `${GENERATED_PREFIX}/${generationId}/${index + 1}-thumb.webp`;
  const thumbnailPath = resolvePrivateStorageKey(thumbnailKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  const thumbnailBuffer = await createThumbnailBuffer(buffer);

  if (thumbnailBuffer) {
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, thumbnailBuffer);
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

export async function saveUploadedReferenceImage({
  buffer,
  mimeType,
  userId,
}: {
  buffer: Buffer;
  mimeType: string;
  userId: string;
}): Promise<PersistedUploadedReferenceImage> {
  const dimensions = readImageSize(buffer);

  if (dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error("invalid uploaded image");
  }

  const ext = extensionForMimeType(mimeType);
  const storageKey = `${UPLOADS_PREFIX}/${userId}/${Date.now()}-${randomUUID()}.${ext}`;
  const filePath = resolvePrivateStorageKey(storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);

  return {
    storageKey,
    width: dimensions.width,
    height: dimensions.height,
    sizeBytes: buffer.byteLength,
    mimeType,
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
