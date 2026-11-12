import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findImage: vi.fn(),
  requireV1Auth: vi.fn(),
  ownedGeneration: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  checkSession: mocks.session,
  isAuthenticatedSession: (session: { status: string }) =>
    session.status === "authenticated",
  adminFailureResponse: () => new Response(null, { status: 403 }),
}));
vi.mock("@/lib/db", () => ({
  db: { generatedImage: { findFirst: mocks.findImage } },
}));
vi.mock("@/lib/agent-auth", () => ({
  AgentAuthError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/agent-images", async () => {
  const { fail } = await import("@/lib/api-response");
  return {
    ownedAgentGeneration: mocks.ownedGeneration,
    agentImageErrorResponse: (error: {
      code: string;
      message: string;
      status: number;
    }) => fail(error.code, error.message, { status: error.status }),
  };
});
vi.mock("@/lib/v1-auth", async () => {
  const { fail } = await import("@/lib/api-response");
  return {
    requireV1Auth: mocks.requireV1Auth,
    v1AuthErrorResponse: () =>
      fail("UNAUTHORIZED", "Unauthorized", { status: 401 }),
  };
});

let storageDir: string;
let original: Buffer;
let saved: Awaited<
  ReturnType<typeof import("@/lib/storage").saveGeneratedImage>
>;
const params = () => ({
  params: Promise.resolve({ id: "gif-job", imageId: "gif-image" }),
});
const imageUrl = "https://chugao.test/api/generations/gif-job/images/gif-image";
const user = { id: "owner", email: "owner@test.local", credits: 100 };
const sha = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "chugao-gif-routes-"));
  vi.stubEnv("PRIVATE_STORAGE_DIR", storageDir);
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/not-used");
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  original = await sharp(pixels, {
    raw: { width: 1, height: 3, channels: 3, pageHeight: 1 },
  })
    .gif({ loop: 0, delay: [100, 200, 300] })
    .toBuffer();
  const { saveGeneratedImage } = await import("@/lib/storage");
  saved = await saveGeneratedImage(
    {
      b64: original.toString("base64"),
      mimeType: "image/png",
      width: 512,
      height: 512,
    },
    "gif-job",
    0,
  );
  mocks.session.mockResolvedValue({ status: "authenticated", user });
  mocks.findImage.mockResolvedValue(saved);
  mocks.requireV1Auth.mockResolvedValue({
    user,
    agentAuthorizationId: "grant",
    apiKeyId: null,
  });
  mocks.ownedGeneration.mockResolvedValue({
    images: [{ ...saved, id: "gif-image" }],
  });
});

afterEach(async () => {
  await rm(storageDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("GIF original image delivery", () => {
  it("downloads the exact animated GIF with the correct MIME, filename and length", async () => {
    const { GET } =
      await import("@/app/api/generations/[id]/images/[imageId]/route");

    const response = await GET(new Request(imageUrl), params());
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="chugao-\d{14}\.gif"$/,
    );
    expect(response.headers.get("content-length")).toBe(
      String(original.length),
    );
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(sha(body)).toBe(sha(original));
    expect((await sharp(body, { animated: true }).metadata()).pages).toBe(3);
    expect(mocks.findImage).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "gif-image",
          generation: { id: "gif-job", deletedAt: null, userId: "owner" },
        },
      }),
    );
  });

  it("serves the static thumbnail as WebP while leaving the GIF original intact", async () => {
    const { GET } =
      await import("@/app/api/generations/[id]/images/[imageId]/route");

    const response = await GET(
      new Request(`${imageUrl}?variant=thumb`),
      params(),
    );
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-disposition")).toBe("inline");
    const metadata = await sharp(body).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.pages ?? 1).toBe(1);
  });

  it("returns exact GIF byte ranges with GIF headers", async () => {
    const { GET } =
      await import("@/app/api/generations/[id]/images/[imageId]/route");

    const response = await GET(
      new Request(imageUrl, { headers: { Range: "bytes=10-35" } }),
      params(),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(response.headers.get("content-range")).toBe(
      `bytes 10-35/${original.length}`,
    );
    expect(response.headers.get("content-length")).toBe("26");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      original.subarray(10, 36),
    );
  });

  it("falls back to the original GIF MIME when there is no thumbnail", async () => {
    mocks.findImage.mockResolvedValue({ ...saved, thumbnailKey: null });
    const { GET } =
      await import("@/app/api/generations/[id]/images/[imageId]/route");

    const response = await GET(
      new Request(`${imageUrl}?variant=thumb`),
      params(),
    );

    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
  });

  it.each(["png", "jpeg", "webp"] as const)(
    "keeps existing %s downloads unchanged",
    async (format) => {
      const buffer = await sharp({
        create: { width: 7, height: 5, channels: 3, background: "red" },
      })
        .toFormat(format)
        .toBuffer();
      const { saveGeneratedImage } = await import("@/lib/storage");
      const staticImage = await saveGeneratedImage(
        {
          b64: buffer.toString("base64"),
          mimeType: `image/${format}`,
          width: 7,
          height: 5,
        },
        "static-job",
        0,
      );
      mocks.findImage.mockResolvedValue(staticImage);
      const { GET } =
        await import("@/app/api/generations/[id]/images/[imageId]/route");

      const response = await GET(new Request(imageUrl), params());

      expect(response.headers.get("content-type")).toBe(`image/${format}`);
      expect(response.headers.get("content-disposition")).toMatch(
        new RegExp(`\\.${format === "jpeg" ? "jpg" : format}"$`),
      );
      expect(Buffer.from(await response.arrayBuffer())).toEqual(buffer);
    },
  );

  it("returns all original GIF frames and actual dimensions in the existing v1 Base64 response", async () => {
    const { GET } =
      await import("@/app/api/v1/generations/[id]/images/[imageId]/route");

    const response = await GET(
      new Request(imageUrl.replace("/api/", "/api/v1/")),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      ok: true,
      data: {
        b64_json: original.toString("base64"),
        mimeType: "image/gif",
        width: 1,
        height: 1,
      },
    });
    const decoded = Buffer.from(body.data.b64_json, "base64");
    expect(sha(decoded)).toBe(sha(original));
    expect((await sharp(decoded, { animated: true }).metadata()).pages).toBe(3);
    expect(mocks.ownedGeneration).toHaveBeenCalledWith(
      { user, agentAuthorizationId: "grant", apiKeyId: undefined },
      "gif-job",
    );
  });

  it("keeps the v1 not-found response for an expired original", async () => {
    await unlink(path.join(storageDir, saved.storageKey));
    const { GET } =
      await import("@/app/api/v1/generations/[id]/images/[imageId]/route");

    const response = await GET(
      new Request(imageUrl.replace("/api/", "/api/v1/")),
      params(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
