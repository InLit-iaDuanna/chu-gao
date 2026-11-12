import { createHash } from "node:crypto";

import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: new Map<string, Buffer | string>(),
  serialize: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/agent-images", () => ({
  serializeAgentGeneration: mocks.serialize,
}));
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    multi: () => {
      const writes: Array<[string, Buffer | string]> = [];
      const transaction = {
        set: (key: string, value: Buffer | string) => {
          writes.push([key, value]);
          return transaction;
        },
        exec: async () =>
          writes.map(([key, value]) => {
            mocks.redis.set(key, value);
            return [null, "OK"];
          }),
      };
      return transaction;
    },
    getdel: async (key: string) => {
      const value = mocks.redis.get(key) ?? null;
      mocks.redis.delete(key);
      return value;
    },
    getBuffer: async (key: string) => mocks.redis.get(key) ?? null,
    del: async (...keys: string[]) =>
      keys.forEach((key) => mocks.redis.delete(key)),
  }),
}));

import { stashApiGenerationImages } from "@/lib/api-image-cache";
import {
  serializeWithInlineImages,
  syncGenerationResponse,
} from "@/lib/api-generation-result";
import { materializeGeneratedImage } from "@/lib/storage";

const sha = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");
type GenerationRow = Parameters<typeof serializeWithInlineImages>[0];

function generation(apiKeyId: string | null = "key"): GenerationRow {
  return { id: "gif-job", apiKeyId, status: "SUCCEEDED" } as GenerationRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.clear();
  mocks.serialize.mockReturnValue({
    id: "gif-job",
    status: "SUCCEEDED",
    images: [],
  });
});

describe("inline API GIF results", () => {
  it("preserves original GIF bytes and actual frame dimensions through materialization, cache and HTTP JSON", async () => {
    const original = await sharp({
      create: {
        width: 19,
        height: 39,
        pageHeight: 13,
        channels: 3,
        background: "red",
      },
    })
      .composite([
        {
          input: {
            create: { width: 19, height: 13, channels: 3, background: "blue" },
          },
          top: 13,
          left: 0,
        },
      ])
      .gif({ loop: 0, delay: [100, 200, 300], keepDuplicateFrames: true })
      .toBuffer();
    const materialized = await materializeGeneratedImage({
      b64: original.toString("base64"),
      mimeType: "image/png",
      width: 512,
      height: 768,
    });
    await stashApiGenerationImages("gif-job", [materialized]);

    const response = await syncGenerationResponse(generation());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      ok: true,
      data: {
        imagesExpired: false,
        images: [{ mimeType: "image/gif", width: 19, height: 13 }],
      },
    });
    const decoded = Buffer.from(body.data.images[0].b64_json, "base64");
    expect(sha(decoded)).toBe(sha(original));
    const metadata = await sharp(decoded, { animated: true }).metadata();
    expect(metadata.pages).toBe(3);
    expect(metadata.delay).toEqual([100, 200, 300]);
    expect(mocks.redis.size).toBe(0);
    await expect(
      serializeWithInlineImages(generation()),
    ).resolves.toMatchObject({ images: [], imagesExpired: true });
  });

  it("keeps stored agent GIF metadata and the existing response shape", async () => {
    const serialized = {
      id: "gif-job",
      status: "SUCCEEDED",
      images: [
        { id: "gif-image", width: 816, height: 816, mimeType: "image/gif" },
      ],
    };
    mocks.serialize.mockReturnValue(serialized);

    const response = await syncGenerationResponse(generation(null));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: serialized });
  });
});
