import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  buildInpaintJob,
  compositeInpaint,
  finishInpaintImage,
  inpaintLayout,
  inpaintTargetAspect,
  prepareInpaint,
  readEditMask,
} from "@/lib/inpaint";
import type { InternalRequest } from "@/lib/models/types";

const W = 160;
const H = 100;

async function solid(width: number, height: number, rgb: [number, number, number]) {
  return sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer();
}

async function maskWithBox(left: number, top: number, w: number, h: number) {
  const box = await sharp({
    create: { width: w, height: h, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: "#000000" } })
    .composite([{ input: box, left, top }])
    .png()
    .toBuffer();
}

async function rawRgb(buffer: Buffer) {
  return sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

describe("inpaint layout", () => {
  it("snaps auto to the nearest supported aspect and keeps explicit sizes", () => {
    expect(inpaintTargetAspect("auto", 1600, 1000)).toBeCloseTo(1.5);
    expect(inpaintTargetAspect("auto", 1000, 1000)).toBe(1);
    expect(inpaintTargetAspect("auto", 700, 1000)).toBeCloseTo(2 / 3);
    expect(inpaintTargetAspect("2048x1152", 100, 100)).toBeCloseTo(16 / 9);
  });

  it("pads to the target aspect without cropping", () => {
    expect(inpaintLayout(160, 100, 1)).toEqual({
      width: 160,
      height: 100,
      padLeft: 0,
      padTop: 30,
      paddedWidth: 160,
      paddedHeight: 160,
    });
    expect(inpaintLayout(150, 100, 1.5).paddedWidth).toBe(150);
  });
});

describe("inpaint masks", () => {
  it("treats bright strokes as the edit area and rejects empty masks", async () => {
    const mask = await readEditMask(await maskWithBox(10, 10, 20, 20), W, H);
    expect(mask.filter((v) => v === 255).length).toBe(400);
    await expect(readEditMask(await solid(W, H, [0, 0, 0]), W, H)).rejects.toThrow(
      "没有涂抹任何区域",
    );
  });

  it("marks the region in magenta and pads to the request aspect", async () => {
    const source = await solid(W, H, [200, 200, 200]);
    const prepared = await prepareInpaint({
      source,
      mask: await maskWithBox(60, 30, 40, 40),
      size: "1024x1024",
    });
    const { data, info } = await rawRgb(prepared.marked);
    expect([info.width, info.height]).toEqual([160, 160]);
    const at = (x: number, y: number) => {
      const p = (y * info.width + x) * 3;
      return [data[p], data[p + 1], data[p + 2]];
    };
    // 涂抹区中心：偏洋红；远处：原色；补边区（顶部）：沿用边缘像素。
    const center = at(80, 30 + 50);
    expect(center[0]).toBeGreaterThan(center[1]);
    expect(at(5, 30 + 5)).toEqual([200, 200, 200]);
    expect(at(5, 2)).toEqual([200, 200, 200]);
  });
});

describe("inpaint compositing", () => {
  it("keeps every pixel outside the feathered region identical to the source", async () => {
    // 原图左右两色，便于检查未涂抹区逐像素不变。
    const left = await solid(W / 2, H, [30, 90, 160]);
    const source = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 220, g: 210, b: 190 } },
    })
      .composite([{ input: left, left: 0, top: 0 }])
      .png()
      .toBuffer();
    const prepared = await prepareInpaint({
      source,
      mask: await maskWithBox(100, 30, 30, 30),
      size: "1536x1024",
    });
    // 模型输出：整张都变了色（模拟模型重画了整图），并且尺寸不同。
    const output = await solid(1536, 1024, [10, 200, 20]);
    const merged = await compositeInpaint({
      source,
      output,
      editMask: prepared.editMask,
      layout: prepared.layout,
    });
    const src = await rawRgb(source);
    const out = await rawRgb(merged.buffer);
    expect([out.info.width, out.info.height]).toEqual([W, H]);
    let changedOutside = 0;
    for (let y = 0; y < H; y += 1)
      for (let x = 0; x < W; x += 1) {
        const far = x < 90 || x > 140 || y < 20 || y > 70;
        const p = (y * W + x) * 3;
        if (
          far &&
          (out.data[p] !== src.data[p] ||
            out.data[p + 1] !== src.data[p + 1] ||
            out.data[p + 2] !== src.data[p + 2])
        )
          changedOutside += 1;
      }
    expect(changedOutside).toBe(0);
    // 涂抹区中心被替换（校色后仍明显偏绿）。
    const c = (45 * W + 115) * 3;
    expect(out.data[c + 1]).toBeGreaterThan(out.data[c]);
  });
});

describe("inpaint job", () => {
  it("puts the marked base first, augments the prompt and composites results", async () => {
    const source = await solid(W, H, [200, 200, 200]);
    const extra = await solid(20, 20, [0, 0, 0]);
    const request = {
      modelId: "gpt-image-2.5-sunburst",
      protocol: "openai-images",
      prompt: "换成一只猫",
      size: "auto",
      quality: "high",
      responseFormat: "b64_json",
      aspectRatio: "1:1",
      resolution: "1K",
      n: 1,
      outputFormat: "png",
      background: "auto",
      referenceImages: [
        { key: "uploads/u/extra.png", mimeType: "image/png", b64: extra.toString("base64") },
        { key: "generated/g/base.png", mimeType: "image/png", b64: source.toString("base64") },
      ],
      inpaint: { baseKey: "generated/g/base.png", maskKey: "uploads/u/mask.png" },
    } as InternalRequest;
    const job = await buildInpaintJob(request, await maskWithBox(60, 30, 40, 40));
    expect(job.request.referenceImages?.map((image) => image.key)).toEqual([
      "generated/g/base.png",
      "uploads/u/extra.png",
    ]);
    expect(job.request.prompt).toContain("换成一只猫");
    expect(job.request.prompt).toContain("magenta");
    const image = await finishInpaintImage(job, await solid(1536, 1024, [0, 0, 255]));
    expect([image.width, image.height, image.mimeType]).toEqual([W, H, "image/png"]);
  });

  it("fails clearly when the base image is missing", async () => {
    const request = {
      referenceImages: [],
      inpaint: { baseKey: "source:abc", maskKey: "uploads/u/mask.png" },
    } as unknown as InternalRequest;
    await expect(buildInpaintJob(request, Buffer.alloc(0))).rejects.toThrow(
      "局部重绘的原图已不可用",
    );
  });
});
