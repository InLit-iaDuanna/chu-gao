import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageDir: string;

async function makeGif(width = 23, height = 17, frames = 3) {
  const pixels = Buffer.alloc(width * height * frames * 3);
  for (let frame = 0; frame < frames; frame += 1) {
    const color = Buffer.from([
      frame % 3 === 0 ? 240 : 10,
      frame % 3 === 1 ? 240 : 10,
      frame % 3 === 2 ? 240 : 10,
    ]);
    pixels.fill(
      color,
      frame * width * height * 3,
      (frame + 1) * width * height * 3,
    );
  }
  return sharp(pixels, {
    raw: { width, height: height * frames, channels: 3, pageHeight: height },
  })
    .gif({
      loop: 2,
      delay: Array.from({ length: frames }, (_, frame) => 100 + frame * 10),
    })
    .toBuffer();
}

function providerImage(buffer: Buffer, mimeType = "image/gif") {
  return { b64: buffer.toString("base64"), width: 512, height: 768, mimeType };
}

function sha(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

beforeEach(async () => {
  storageDir = await mkdtemp(path.join(os.tmpdir(), "chugao-gif-storage-"));
  vi.stubEnv("PRIVATE_STORAGE_DIR", storageDir);
  vi.stubEnv("MAX_IMAGE_DIMENSION", "16384");
  vi.stubEnv("MAX_IMAGE_PIXELS", "40000000");
  vi.resetModules();
});

afterEach(async () => {
  await rm(storageDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("generated GIF storage", () => {
  it.each(["image/gif", "image/png", "image/webp", ""])(
    "materializes original GIF bytes and dimensions even when declared as %s",
    async (mimeType) => {
      const original = await makeGif();
      const { materializeGeneratedImage } = await import("@/lib/storage");

      const result = await materializeGeneratedImage(
        providerImage(original, mimeType),
      );

      expect(result).toMatchObject({
        mimeType: "image/gif",
        width: 23,
        height: 17,
      });
      expect(sha(result.buffer)).toBe(sha(original));
      const metadata = await sharp(result.buffer, {
        animated: true,
      }).metadata();
      expect(metadata.pages).toBe(3);
      expect(metadata.pageHeight).toBe(17);
      expect(metadata.loop).toBe(2);
      expect(metadata.delay).toEqual([100, 110, 120]);
      expect(await readdir(storageDir)).toEqual([]);
    },
  );

  it("accepts a GIF data URL without changing its bytes", async () => {
    const original = await makeGif();
    const { materializeGeneratedImage } = await import("@/lib/storage");
    const image = providerImage(original);
    image.b64 = `data:image/gif;base64,${image.b64}`;

    const result = await materializeGeneratedImage(image);

    expect(result.buffer).toEqual(original);
    expect(result).toMatchObject({
      mimeType: "image/gif",
      width: 23,
      height: 17,
    });
  });

  it("preserves a single-frame GIF87a as GIF", async () => {
    const original = await makeGif(23, 17, 1);
    original.write("GIF87a", 0, "ascii");
    const { materializeGeneratedImage } = await import("@/lib/storage");

    const result = await materializeGeneratedImage(providerImage(original));

    expect(result).toMatchObject({
      mimeType: "image/gif",
      width: 23,
      height: 17,
    });
    expect(result.buffer).toEqual(original);
  });

  it("persists the original animation and makes a static first-frame WebP thumbnail", async () => {
    const original = await makeGif();
    const {
      saveGeneratedImage,
      readPrivateStorageKey,
      mimeTypeForStorageKey,
      extensionForMimeType,
    } = await import("@/lib/storage");

    const saved = await saveGeneratedImage(
      providerImage(original, "image/png"),
      "gif-job",
      0,
      "execution/one",
    );

    expect(saved).toMatchObject({
      storageKey: "generated/gif-job/1-executionone.gif",
      thumbnailKey: "generated/gif-job/1-executionone-thumb.webp",
      width: 23,
      height: 17,
      sizeBytes: original.length,
      mimeType: "image/gif",
    });
    expect(sha(await readPrivateStorageKey(saved.storageKey))).toBe(
      sha(original),
    );
    expect(mimeTypeForStorageKey(saved.storageKey)).toBe("image/gif");
    expect(mimeTypeForStorageKey("generated/GIF-JOB/1.GIF")).toBe("image/gif");
    expect(extensionForMimeType(saved.mimeType)).toBe("gif");

    const thumbnail = await readPrivateStorageKey(saved.thumbnailKey!);
    const metadata = await sharp(thumbnail).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 23, height: 17 });
    expect(metadata.pages ?? 1).toBe(1);
    const expectedThumbnail = await sharp(original, { page: 0, pages: 1 })
      .rotate()
      .resize({
        width: 720,
        height: 720,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 72, effort: 4 })
      .toBuffer();
    expect(thumbnail).toEqual(expectedThumbnail);
    const [red, green, blue] = (
      await sharp(thumbnail).raw().toBuffer()
    ).subarray(0, 3);
    expect(red).toBeGreaterThan(200);
    expect(green).toBeLessThan(40);
    expect(blue).toBeLessThan(40);
  });

  it("uses per-frame height for dimension limits instead of the stacked animation height", async () => {
    vi.stubEnv("MAX_IMAGE_DIMENSION", "32");
    vi.stubEnv("MAX_IMAGE_PIXELS", "10000");
    const original = await makeGif(23, 17, 16);
    const { materializeGeneratedImage } = await import("@/lib/storage");

    const result = await materializeGeneratedImage(providerImage(original));

    expect(result).toMatchObject({ width: 23, height: 17 });
    const metadata = await sharp(result.buffer, { animated: true }).metadata();
    expect(metadata.pages).toBe(16);
    expect(metadata.height).toBe(17 * 16);
  });

  it.each([
    { width: 33, height: 17, pixels: 10000 },
    { width: 23, height: 33, pixels: 10000 },
    { width: 23, height: 17, pixels: 390 },
    { width: 23, height: 17, pixels: 1000 },
  ])(
    "rejects excessive dimensions or decoded animation pixels: %j",
    async ({ width, height, pixels }) => {
      vi.stubEnv("MAX_IMAGE_DIMENSION", "32");
      vi.stubEnv("MAX_IMAGE_PIXELS", String(pixels));
      const original = await makeGif(width, height);
      const { materializeGeneratedImage, saveGeneratedImage } =
        await import("@/lib/storage");

      await expect(
        materializeGeneratedImage(providerImage(original)),
      ).rejects.toThrow(/GIF/);
      await expect(
        saveGeneratedImage(providerImage(original), "oversized", 0),
      ).rejects.toThrow(/GIF/);
      expect(await readdir(storageDir)).toEqual([]);
    },
  );

  it.each([0, 3, 6, 10, 13, 40, -1])(
    "rejects a GIF truncated at %i without writing files",
    async (cut) => {
      const original = await makeGif();
      const truncated = original.subarray(0, cut);
      const { materializeGeneratedImage, saveGeneratedImage } =
        await import("@/lib/storage");

      await expect(
        materializeGeneratedImage(providerImage(truncated)),
      ).rejects.toThrow();
      await expect(
        saveGeneratedImage(providerImage(truncated), "broken", 0),
      ).rejects.toThrow();
      expect(await readdir(storageDir)).toEqual([]);
    },
  );

  it("rejects PNG bytes declared as GIF instead of labeling them as an animation", async () => {
    const png = await sharp({
      create: { width: 7, height: 5, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const { materializeGeneratedImage } = await import("@/lib/storage");

    await expect(materializeGeneratedImage(providerImage(png))).rejects.toThrow(
      "invalid generated GIF",
    );
  });

  it("rejects corrupt pixel data in a later frame even with valid metadata and a complete trailer", async () => {
    const corrupt = await makeGif();
    corrupt[corrupt.length - 3] = 0xff;
    expect((await sharp(corrupt, { animated: true }).metadata()).pages).toBe(3);
    const { materializeGeneratedImage, saveGeneratedImage } =
      await import("@/lib/storage");

    await expect(
      materializeGeneratedImage(providerImage(corrupt)),
    ).rejects.toThrow("invalid generated GIF");
    await expect(
      saveGeneratedImage(providerImage(corrupt), "corrupt", 0),
    ).rejects.toThrow("invalid generated GIF");
    expect(await readdir(storageDir)).toEqual([]);
  });

  it.each(["png", "jpeg", "webp"] as const)(
    "preserves existing %s bytes, MIME and provider dimensions",
    async (format) => {
      const original = await sharp({
        create: { width: 7, height: 5, channels: 3, background: "red" },
      })
        .toFormat(format)
        .toBuffer();
      const mimeType = `image/${format}`;
      const {
        materializeGeneratedImage,
        saveGeneratedImage,
        readPrivateStorageKey,
      } = await import("@/lib/storage");
      const image = providerImage(original, mimeType);

      const result = await materializeGeneratedImage(image);
      const saved = await saveGeneratedImage(image, "static", 0);

      expect(result).toMatchObject({ mimeType, width: 512, height: 768 });
      expect(result.buffer).toEqual(original);
      expect(saved).toMatchObject({ mimeType, width: 512, height: 768 });
      expect(saved.storageKey).toBe(
        `generated/static/1.${format === "jpeg" ? "jpg" : format}`,
      );
      expect(await readPrivateStorageKey(saved.storageKey)).toEqual(original);
    },
  );
});
