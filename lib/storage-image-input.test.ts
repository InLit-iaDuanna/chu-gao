import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { sniffImageFormat, UnsupportedImageFormatError } from "@/lib/storage";

async function jpeg(size = 32): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: "#c33" } })
    .jpeg()
    .toBuffer();
}

describe("uploaded image sniffing", () => {
  it("recognises the formats the reference pipeline stores", async () => {
    expect(sniffImageFormat(await jpeg())).toBe("jpeg");
    expect(
      sniffImageFormat(
        await sharp({ create: { width: 8, height: 8, channels: 4, background: "#0f08" } })
          .png()
          .toBuffer(),
      ),
    ).toBe("png");
    expect(
      sniffImageFormat(
        await sharp({ create: { width: 8, height: 8, channels: 3, background: "#08f" } })
          .webp()
          .toBuffer(),
      ),
    ).toBe("webp");
  });

  it("detects iPhone HEIC and AVIF containers", () => {
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("ftypheic", "ascii"),
      Buffer.alloc(16),
    ]);
    expect(sniffImageFormat(heic)).toBe("heic");
    const avif = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x1c]),
      Buffer.from("ftypavif", "ascii"),
      Buffer.alloc(16),
    ]);
    expect(sniffImageFormat(avif)).toBe("avif");
  });

  it("reports null for data that is not an image", () => {
    expect(sniffImageFormat(Buffer.from("hello world, not an image"))).toBeNull();
    expect(sniffImageFormat(Buffer.alloc(0))).toBeNull();
  });

  it("exports a distinguishable format error", () => {
    const error = new UnsupportedImageFormatError("heic");
    expect(error).toBeInstanceOf(Error);
    expect(error.detected).toBe("heic");
  });
});
