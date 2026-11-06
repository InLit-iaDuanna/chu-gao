import {
  AssetRecordType,
  createShapeId,
  type Editor,
  type TLPageId,
  type TLShapeId,
} from "tldraw";
import type { Generation, GenerationImage } from "../lib/types";
import { uploadReferenceImage } from "../lib/api";
import { exportImage } from "./vendor/ArtboardShape";

export interface CanvasReference {
  key: string;
  previewUrl: string;
  name: string;
}

export interface CanvasDraft {
  prompt: string;
  modelId: string;
  size: string;
  quality: string;
  background: string;
  outputFormat: string;
  n: number;
  references: CanvasReference[];
}

export interface CanvasJob {
  id: string;
  pageId: TLPageId;
  x: number;
  y: number;
}

function validJobs(value: unknown): CanvasJob[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (job) =>
      job &&
      typeof job === "object" &&
      typeof job.id === "string" &&
      job.id.length > 0 &&
      typeof job.pageId === "string" &&
      job.pageId.startsWith("page:") &&
      Number.isFinite(job.x) &&
      Number.isFinite(job.y),
  );
}

export function readPendingJobs(userId: string): CanvasJob[] {
  try {
    return validJobs(
      JSON.parse(
        localStorage.getItem(`chugao.comfyart.jobs.v1.${userId}`) || "[]",
      ),
    );
  } catch {
    return [];
  }
}

export function persistPendingJobs(userId: string, jobs: CanvasJob[]) {
  localStorage.setItem(
    `chugao.comfyart.jobs.v1.${userId}`,
    JSON.stringify(jobs),
  );
}

export function readJobs(editor: Editor): CanvasJob[] {
  const jobs = editor.getDocumentSettings().meta.chugaoJobs;
  return validJobs(jobs);
}

export function writeJobs(editor: Editor, jobs: CanvasJob[]) {
  editor.updateDocumentSettings({
    meta: {
      ...editor.getDocumentSettings().meta,
      chugaoJobs: JSON.parse(JSON.stringify(jobs)),
    },
  });
}

export function generationPosition(editor: Editor): Omit<CanvasJob, "id"> {
  const selected = editor.getSelectionPageBounds();
  const point = editor.getViewportPageBounds().center;
  return {
    pageId: editor.getCurrentPageId(),
    x: selected ? selected.maxX + 64 : point.x - 256,
    y: selected ? selected.minY : point.y - 256,
  };
}

export function placeImage(
  editor: Editor,
  image: GenerationImage,
  position: Omit<CanvasJob, "id">,
  generation?: Pick<Generation, "id" | "prompt" | "modelId">,
  deduplicate = false,
) {
  const id = deduplicate
    ? createShapeId(`chugao-image-${image.id}`)
    : createShapeId();
  if (editor.getShape(id)) return id;
  const assetId = AssetRecordType.createId(`chugao-image-${image.id}`);
  const w = image.width || 1024;
  const h = image.height || 1024;
  const scale = Math.min(1, 640 / Math.max(w, h));
  if (!editor.getAsset(assetId)) {
    editor.createAssets([
      {
        id: assetId,
        typeName: "asset",
        type: "image",
        props: {
          name: generation?.prompt.slice(0, 60) || "图片",
          src: image.src || image.url,
          w,
          h,
          mimeType: image.mimeType || "image/png",
          isAnimated: false,
        },
        meta: {
          imageId: image.id,
          downloadUrl: image.downloadUrl || image.url,
        },
      },
    ]);
  }
  const parentId = editor.getPage(position.pageId)
    ? position.pageId
    : editor.getCurrentPageId();
  editor.createShape({
    id,
    type: "image",
    parentId,
    x: position.x,
    y: position.y,
    props: { assetId, w: w * scale, h: h * scale },
    meta: {
      imageId: image.id,
      ...(generation
        ? {
            generationId: generation.id,
            prompt: generation.prompt,
            modelId: generation.modelId,
          }
        : {}),
    },
  });
  return id;
}

export function placeGeneration(
  editor: Editor,
  generation: Generation,
  job: CanvasJob,
) {
  return generation.images.map((image, index) =>
    placeImage(
      editor,
      image,
      { ...job, x: job.x + index * 672 },
      generation,
      true,
    ),
  );
}

export async function selectionReference(
  editor: Editor,
  ids: TLShapeId[],
): Promise<CanvasReference> {
  if (!ids.length) throw new Error("请先选择图片、草图或画板");
  const { blob } = await exportImage(editor, ids, {
    format: "png",
    background: false,
    padding: 0,
    scale: 1,
  });
  const file = new File([blob], "canvas-reference.png", { type: "image/png" });
  const result = await uploadReferenceImage(file);
  return {
    key: result.key,
    previewUrl: uploadUrl(result.key),
    name: "画布选区",
  };
}

export function uploadUrl(key: string) {
  return `/api/upload?key=${encodeURIComponent(key)}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
