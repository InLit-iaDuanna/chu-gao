import {
  access,
  mkdir,
  mkdtemp,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalStorageDir = process.env.PRIVATE_STORAGE_DIR;
let storageDir = "";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  storageDir = await mkdtemp(
    path.join(os.tmpdir(), "chugao-upload-retention-"),
  );
  process.env.PRIVATE_STORAGE_DIR = storageDir;
  vi.resetModules();
});

afterEach(async () => {
  if (originalStorageDir === undefined) delete process.env.PRIVATE_STORAGE_DIR;
  else process.env.PRIVATE_STORAGE_DIR = originalStorageDir;
  await rm(storageDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("uploaded reference retention", () => {
  it("removes only expired, unprotected files under the uploads prefix", async () => {
    const userDirectory = path.join(storageDir, "uploads", "user-1");
    const designDirectory = path.join(storageDir, "design-posts", "post-1");
    await mkdir(userDirectory, { recursive: true });
    await mkdir(designDirectory, { recursive: true });

    const expired = path.join(userDirectory, "expired.png");
    const protectedUpload = path.join(userDirectory, "protected.png");
    const recent = path.join(userDirectory, "recent.png");
    const publicSnapshot = path.join(designDirectory, "old.png");
    await Promise.all(
      [expired, protectedUpload, recent, publicSnapshot].map((filePath) =>
        writeFile(filePath, "image"),
      ),
    );
    const oldTime = new Date("2026-07-01T00:00:00.000Z");
    const recentTime = new Date("2026-08-03T00:00:00.000Z");
    await Promise.all([
      utimes(expired, oldTime, oldTime),
      utimes(protectedUpload, oldTime, oldTime),
      utimes(recent, recentTime, recentTime),
      utimes(publicSnapshot, oldTime, oldTime),
    ]);

    const { removeExpiredUploadedReferences } = await import("@/lib/storage");
    const removed = await removeExpiredUploadedReferences({
      cutoff: new Date("2026-08-01T00:00:00.000Z"),
      protectedKeys: ["uploads/user-1/protected.png"],
    });

    expect(removed).toBe(1);
    await expect(exists(expired)).resolves.toBe(false);
    await expect(exists(protectedUpload)).resolves.toBe(true);
    await expect(exists(recent)).resolves.toBe(true);
    await expect(exists(publicSnapshot)).resolves.toBe(true);
  });
});

describe("provider image DNS pinning", () => {
  it("returns all addresses in the shape required by Node's all lookup mode", async () => {
    const { pinnedProviderImageLookup } = await import("@/lib/storage");
    const callback = vi.fn();

    pinnedProviderImageLookup("203.0.113.10", 4)(
      "images.example",
      { all: true },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, [
      { address: "203.0.113.10", family: 4 },
    ]);
  });

  it("keeps the single-address callback shape for legacy lookup calls", async () => {
    const { pinnedProviderImageLookup } = await import("@/lib/storage");
    const callback = vi.fn();

    pinnedProviderImageLookup("203.0.113.10", 4)(
      "images.example",
      { all: false },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, "203.0.113.10", 4);
  });
});
