import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, read, encode } = vi.hoisted(() => ({
  findMany: vi.fn(),
  read: vi.fn(),
  encode: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { generatedImage: { findMany } } }));
vi.mock("@/lib/storage", () => ({
  normalizeUploadedReferenceKey: (key: string) =>
    key.startsWith("uploads/") && !key.includes("..") ? key : null,
  readPrivateStorageKey: read,
}));
vi.mock("sharp", () => ({
  default: (buffer: Buffer) => {
    const chain = {
      rotate: () => chain,
      resize: () => chain,
      jpeg: () => chain,
      toBuffer: () => encode(buffer),
    };
    return chain;
  },
}));
import {
  ChatReferenceError,
  normalizeChatReferences,
  resolveChatReferences,
  storedChatReferences,
  type ChatReference,
} from "./chat-references";

beforeEach(() => {
  vi.clearAllMocks();
  read.mockResolvedValue(Buffer.from("original"));
  encode.mockResolvedValue(Buffer.from("preview"));
});

describe("private conversation references", () => {
  it("rejects uploads owned by another user before reading storage", async () => {
    await expect(
      resolveChatReferences("me", ["uploads/other/image.png"], []),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects inaccessible generated images", async () => {
    findMany.mockResolvedValue([]);
    await expect(resolveChatReferences("me", [], ["image"])).rejects.toThrow();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["image"] },
          generation: { userId: "me", deletedAt: null },
        },
      }),
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("encodes authorized uploads and selected results in reference order", async () => {
    findMany.mockResolvedValue([
      { id: "second", storageKey: "g/second.png" },
      { id: "first", storageKey: "g/first.png" },
    ]);
    const parts = await resolveChatReferences(
      "me",
      ["uploads/me/ref.png"],
      ["first", "second"],
    );
    expect(read.mock.calls.map(([key]) => key)).toEqual([
      "uploads/me/ref.png",
      "g/first.png",
      "g/second.png",
    ]);
    expect(parts).toHaveLength(3);
    expect(parts[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("preserves interleaved generated/upload order and labels despite reversed DB results", async () => {
    findMany.mockResolvedValue([
      { id: "a", storageKey: "g/a.png" },
      { id: "b", storageKey: "g/b.png" },
    ]);
    read.mockImplementation(async (key: string) => Buffer.from(key));
    encode.mockImplementation(async (buffer: Buffer) => buffer);
    const references: ChatReference[] = [
      { kind: "generated", id: "b", label: "first" },
      { kind: "upload", key: "uploads/me/ref.png", label: "second" },
      { kind: "generated", id: "a", label: "third" },
    ];
    const original = structuredClone(references);
    const parts = await resolveChatReferences("me", {
      references,
      referenceImageKeys: ["uploads/other/ignored.png"],
      sourceImageIds: ["ignored"],
    });
    expect(read.mock.calls.map(([key]) => key)).toEqual([
      "g/b.png",
      "uploads/me/ref.png",
      "g/a.png",
    ]);
    expect(
      parts.map((part) =>
        Buffer.from(part.image_url.url.split(",")[1], "base64").toString(),
      ),
    ).toEqual(["g/b.png", "uploads/me/ref.png", "g/a.png"]);
    expect(references).toEqual(original);
    expect(storedChatReferences({ references })).toEqual(references);
    expect(storedChatReferences(references)).toEqual(references);
  });

  it("swapping two ordered references swaps the actual image bytes, including duplicate identity", async () => {
    findMany.mockResolvedValue([{ id: "image", storageKey: "g/image.png" }]);
    read.mockImplementation(async (key: string) => Buffer.from(key));
    encode.mockImplementation(async (buffer: Buffer) => buffer);
    const one: ChatReference = { kind: "generated", id: "image" };
    const two: ChatReference = { kind: "upload", key: "uploads/me/ref.png" };
    const first = await resolveChatReferences("me", [one, two]);
    const swapped = await resolveChatReferences("me", [two, one, one]);
    expect(swapped.map((part) => part.image_url.url)).toEqual([
      first[1].image_url.url,
      first[0].image_url.url,
      first[0].image_url.url,
    ]);
  });

  it("uses legacy arrays only when no ordered list is provided; [] is authoritative", async () => {
    expect(
      normalizeChatReferences({
        referenceImageKeys: ["a", "a", "b"],
        sourceImageIds: ["c", "c"],
      }),
    ).toEqual([
      { kind: "upload", key: "a" },
      { kind: "upload", key: "b" },
      { kind: "generated", id: "c" },
    ]);
    expect(
      await resolveChatReferences("me", {
        references: [],
        sourceImageIds: ["inaccessible"],
      }),
    ).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([
    { references: [{ kind: "upload", key: "uploads/other/image.png" }] },
    { references: [{ kind: "upload", key: "uploads/me/../other/image.png" }] },
    { references: [{ kind: "generated", id: "missing" }] },
    { references: [{ kind: "unknown", id: "x" }] },
    {
      references: Array.from({ length: 9 }, (_, index) => ({
        kind: "upload",
        key: `uploads/me/${index}.png`,
      })),
    },
  ])(
    "rejects invalid ordered references before storage reads",
    async ({ references }) => {
      findMany.mockResolvedValue([]);
      await expect(
        resolveChatReferences("me", {
          references: references as unknown as ChatReference[],
        }),
      ).rejects.toBeInstanceOf(ChatReferenceError);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("reports stable public codes for missing files and oversized previews", async () => {
    read.mockRejectedValueOnce(new Error("private filesystem path"));
    await expect(
      resolveChatReferences("me", [
        { kind: "upload", key: "uploads/me/ref.png" },
      ]),
    ).rejects.toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      statusCode: 400,
      message: "REFERENCE_NOT_FOUND",
    });
    read.mockResolvedValueOnce(Buffer.from("image"));
    encode.mockRejectedValueOnce(new Error("REFERENCE_TOO_LARGE"));
    await expect(
      resolveChatReferences("me", [
        { kind: "upload", key: "uploads/me/ref.png" },
      ]),
    ).rejects.toMatchObject({ code: "REFERENCE_TOO_LARGE", statusCode: 400 });
  });
});
