import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor, TLPageId } from "tldraw";
import type { Generation } from "../lib/types";

let sequence = 0;
vi.mock("tldraw", () => ({
  AssetRecordType: { createId: (id: string) => `asset:${id}` },
  createShapeId: (id?: string) => `shape:${id || ++sequence}`,
}));
vi.mock("./vendor/ArtboardShape", () => ({ exportImage: vi.fn() }));
vi.mock("../lib/api", () => ({ uploadReferenceImage: vi.fn() }));

import {
  placeGeneration,
  placeImage,
  persistPendingJobs,
  readPendingJobs,
  readJobs,
} from "./canvas-bridge";

const job = {
  id: "generation-1",
  pageId: "page:original" as TLPageId,
  x: 100,
  y: 200,
};
const generation = {
  id: job.id,
  prompt: "poster",
  modelId: "gpt-image-2.5-flare",
  images: [
    {
      id: "image-1",
      width: 2048,
      height: 1024,
      src: "/private/image-1",
      url: "/private/image-1",
      downloadUrl: "/private/image-1?download=1",
      mimeType: "image/png",
    },
  ],
} as Generation;

function fakeEditor(pageExists = true) {
  const shapes = new Map<string, unknown>();
  const assets = new Map<string, unknown>();
  const createShape = vi.fn((shape: { id: string }) => {
    shapes.set(shape.id, shape);
  });
  const editor = {
    getShape: (id: string) => shapes.get(id),
    getAsset: (id: string) => assets.get(id),
    createShape,
    createAssets: vi.fn((items: { id: string }[]) =>
      items.forEach((asset) => assets.set(asset.id, asset)),
    ),
    getPage: () => (pageExists ? {} : null),
    getCurrentPageId: () => "page:current",
  } as unknown as Editor;
  return { editor, createShape, assets };
}

beforeEach(() => {
  localStorage.clear();
  sequence = 0;
});

describe("ComfyArt generation bridge", () => {
  it("places completed results on their original page exactly once after reconnect", () => {
    const { editor, createShape } = fakeEditor();
    placeGeneration(editor, generation, job);
    placeGeneration(editor, generation, job);
    expect(createShape).toHaveBeenCalledTimes(1);
    expect(createShape).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: "page:original",
        x: 100,
        y: 200,
        props: expect.objectContaining({ w: 640, h: 320 }),
      }),
    );
  });

  it("allows deliberate reuse of a history image while reusing its asset", () => {
    const { editor, createShape, assets } = fakeEditor();
    const a = placeImage(editor, generation.images[0], job, generation);
    const b = placeImage(editor, generation.images[0], job, generation);
    expect(a).not.toBe(b);
    expect(createShape).toHaveBeenCalledTimes(2);
    expect(assets.size).toBe(1);
  });

  it("recovers the image to the current page if its original page was deleted", () => {
    const { editor, createShape } = fakeEditor(false);
    placeGeneration(editor, generation, job);
    expect(createShape).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "page:current" }),
    );
  });

  it("isolates pending tasks by account and rejects corrupt task metadata", () => {
    persistPendingJobs("alice", [job]);
    expect(readPendingJobs("alice")).toEqual([job]);
    expect(readPendingJobs("bob")).toEqual([]);
    localStorage.setItem("chugao.comfyart.jobs.v1.bob", '{"invalid":true}');
    expect(readPendingJobs("bob")).toEqual([]);
    const editor = {
      getDocumentSettings: () => ({
        meta: {
          chugaoJobs: [job, { ...job, x: "100" }, { ...job, pageId: "bad" }],
        },
      }),
    } as unknown as Editor;
    expect(readJobs(editor)).toEqual([job]);
  });
});
