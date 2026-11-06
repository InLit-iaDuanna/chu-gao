"use client";

import {
  AlignCenter,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  BringToFront,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  GripVertical,
  LayoutGrid,
  LoaderCircle,
  Lock,
  MousePointer2,
  PanelsTopLeft,
  Redo2,
  RectangleHorizontal,
  RotateCcw,
  SendToBack,
  Share2,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { savePublishPreload } from "@/components/inspiration/publish-preload";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  getMe,
  listGenerations,
  uploadReferenceImage,
} from "@/components/studio/lib/api";
import type { Generation } from "@/components/studio/lib/types";
import { buildCanvasPublishPreload } from "./canvas-publish";
import { NumberField } from "./DesignNumberField";
import {
  getObjectBounds,
  intersectsBounds,
  snapObjectPosition,
  type DesignBounds,
  type SnapGuides,
} from "./design-geometry";
import {
  DEFAULT_DESIGN_DOCUMENT,
  nextDesignId,
  parseDesignDocument,
  type DesignDocument,
  type DesignImageObject,
  type DesignObject,
  type DesignObjectType,
} from "./design-types";

const STORAGE_PREFIX = "chugao.design.v1";
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.5;
const MAX_ARTBOARD_DIMENSION = 16_384;
const MAX_ARTBOARD_PIXELS = 40_000_000;
const EMPTY_GUIDES: SnapGuides = { x: null, y: null };
type DesignTool = "select" | "text" | "rect" | "ellipse";

const ARTBOARD_PRESETS = [
  { value: "1080x1350", label: "小红书 3:4", width: 1080, height: 1350 },
  { value: "1080x1440", label: "小红书 3:4 高清", width: 1080, height: 1440 },
  { value: "1080x1920", label: "手机竖屏 9:16", width: 1080, height: 1920 },
  { value: "1920x1080", label: "演示文稿 16:9", width: 1920, height: 1080 },
  { value: "1200x1200", label: "社交方图", width: 1200, height: 1200 },
  { value: "794x1123", label: "A4 竖版", width: 794, height: 1123 },
] as const;

type ResizeDirection = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
type TransformInteraction =
  | {
      type: "move";
      startX: number;
      startY: number;
      object: DesignObject;
      objects: DesignObject[];
    }
  | {
      type: "resize";
      direction: ResizeDirection;
      startX: number;
      startY: number;
      object: DesignObject;
    }
  | {
      type: "rotate";
      centerX: number;
      centerY: number;
      startAngle: number;
      object: DesignObject;
    }
  | {
      type: "draw";
      startX: number;
      startY: number;
      object: DesignObject;
    };

function objectIcon(type: DesignObjectType) {
  if (type === "text") return Type;
  if (type === "ellipse") return Circle;
  if (type === "image") return ImagePlus;
  return RectangleHorizontal;
}

function createDesignObject(
  type: DesignObjectType,
  x: number,
  y: number,
  image?: Pick<DesignImageObject, "src" | "name">,
): DesignObject {
  const base = {
    id: nextDesignId(type),
    x,
    y,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  if (type === "text") {
    return {
      ...base,
      type,
      name: "文字",
      width: 360,
      height: 96,
      text: "输入文字",
      fontSize: 52,
      fontWeight: 600,
      color: "#171717",
      align: "left",
    };
  }
  if (type === "image") {
    return {
      ...base,
      type,
      name: image?.name ?? "图片",
      width: 360,
      height: 280,
      src: image?.src ?? "",
      fit: "cover",
      radius: 0,
    };
  }
  return {
    ...base,
    type,
    name: type === "ellipse" ? "椭圆" : "矩形",
    width: 360,
    height: 220,
    fill: type === "ellipse" ? "#f59e0b" : "#2563eb",
    stroke: "#000000",
    strokeWidth: 0,
    radius: type === "rect" ? 12 : 0,
  };
}

function clampArtboardDimension(value: number, otherDimension: number): number {
  const pixelLimit = Math.floor(
    MAX_ARTBOARD_PIXELS / Math.max(1, otherDimension),
  );
  return Math.max(
    1,
    Math.min(MAX_ARTBOARD_DIMENSION, pixelLimit, Math.round(value)),
  );
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char] ?? char,
  );
}

function wrapSvgText(text: string, maxCharacters: number): string[] {
  return text.split("\n").flatMap((line) => {
    if (!line) return [""];
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += maxCharacters) {
      chunks.push(line.slice(index, index + maxCharacters));
    }
    return chunks;
  });
}

function documentToSvg(doc: DesignDocument): string {
  const objects = doc.objects
    .filter((object) => object.visible)
    .map((object) => {
      const transform = `translate(${object.x} ${object.y}) rotate(${object.rotation} ${object.width / 2} ${object.height / 2})`;
      if (object.type === "text") {
        const clipId = `text-clip-${escapeXml(object.id)}`;
        const x =
          object.align === "center"
            ? object.width / 2
            : object.align === "right"
              ? object.width
              : 0;
        const anchor =
          object.align === "center"
            ? "middle"
            : object.align === "right"
              ? "end"
              : "start";
        const maxCharacters = Math.max(
          1,
          Math.floor(object.width / (object.fontSize * 0.58)),
        );
        const lines = wrapSvgText(object.text, maxCharacters);
        const tspans = lines
          .map(
            (line, index) =>
              `<tspan x="${x}" dy="${index === 0 ? object.fontSize : object.fontSize * 1.2}">${escapeXml(line)}</tspan>`,
          )
          .join("");
        return `<g transform="${transform}" opacity="${object.opacity}"><clipPath id="${clipId}"><rect width="${object.width}" height="${object.height}"/></clipPath><text x="${x}" y="0" fill="${object.color}" font-family="Arial, sans-serif" font-size="${object.fontSize}" font-weight="${object.fontWeight}" text-anchor="${anchor}" clip-path="url(#${clipId})">${tspans}</text></g>`;
      }
      if (object.type === "image") {
        const clipId = `image-clip-${escapeXml(object.id)}`;
        return `<g transform="${transform}" opacity="${object.opacity}"><clipPath id="${clipId}"><rect width="${object.width}" height="${object.height}" rx="${object.radius}"/></clipPath><image href="${escapeXml(object.src)}" x="0" y="0" width="${object.width}" height="${object.height}" preserveAspectRatio="${object.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}" clip-path="url(#${clipId})"/></g>`;
      }
      const shape =
        object.type === "ellipse"
          ? `<ellipse cx="${object.width / 2}" cy="${object.height / 2}" rx="${object.width / 2}" ry="${object.height / 2}"`
          : `<rect width="${object.width}" height="${object.height}" rx="${object.radius}"`;
      return `${shape} fill="${object.fill}" stroke="${object.stroke}" stroke-width="${object.strokeWidth}" transform="${transform}" opacity="${object.opacity}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}"><rect width="100%" height="100%" fill="${doc.background}"/>${objects}</svg>`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function inlineDocumentImages(
  document: DesignDocument,
): Promise<DesignDocument> {
  const objects = await Promise.all(
    document.objects.map(async (object): Promise<DesignObject> => {
      if (object.type !== "image" || object.src.startsWith("data:")) {
        return object;
      }
      try {
        const response = await fetch(object.src);
        if (!response.ok) return object;
        return { ...object, src: await blobToDataUrl(await response.blob()) };
      } catch {
        return object;
      }
    }),
  );
  return { ...document, objects };
}

async function renderDocument(
  document: DesignDocument,
  format: "svg" | "png",
): Promise<Blob> {
  const portable = await inlineDocumentImages(document);
  const form = new FormData();
  form.set("svg", documentToSvg(portable));
  form.set("format", format);
  form.set("name", document.name || "design");
  const response = await fetch("/api/canvas/export", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message || "导出服务暂时不可用");
  }
  return response.blob();
}

export function DesignStudio() {
  const router = useRouter();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [accountId, setAccountId] = useState("anonymous");
  const [doc, setDoc] = useState<DesignDocument>(DEFAULT_DESIGN_DOCUMENT);
  const docRef = useRef(doc);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<DesignTool>("select");
  const [zoom, setZoom] = useState(0.5);
  const [showGrid, setShowGrid] = useState(false);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>(EMPTY_GUIDES);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [leftTab, setLeftTab] = useState<"layers" | "assets">("layers");
  const [mobilePanel, setMobilePanel] = useState<"left" | "right" | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState<"svg" | "png" | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const pastRef = useRef<DesignDocument[]>([]);
  const futureRef = useRef<DesignDocument[]>([]);
  const [, setHistoryRevision] = useState(0);
  const transformStartRef = useRef<DesignDocument | null>(null);
  const interactionRef = useRef<TransformInteraction | null>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const clipboardRef = useRef<DesignObject[]>([]);
  const [selectionMarquee, setSelectionMarquee] = useState<DesignBounds | null>(
    null,
  );

  docRef.current = doc;
  const storageKey = `${STORAGE_PREFIX}.${accountId}`;
  const selected =
    doc.objects.find((object) => object.id === selectedId) ?? null;
  const selectedObjects = doc.objects.filter((object) =>
    selectedIds.includes(object.id),
  );
  const multiSelectionBounds = getObjectBounds(selectedObjects);

  const selectOnly = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedIds(id ? [id] : []);
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id];
      setSelectedId(next.at(-1) ?? null);
      return next;
    });
  }, []);

  useEffect(() => {
    void Promise.allSettled([getMe(), listGenerations({ limit: 50 })]).then(
      ([me, history]) => {
        const id = me.status === "fulfilled" ? me.value.id : "anonymous";
        setAccountId(id);
        setDoc(
          parseDesignDocument(
            window.localStorage.getItem(`${STORAGE_PREFIX}.${id}`),
          ),
        );
        if (history.status === "fulfilled") setGenerations(history.value.items);
        setHydrated(true);
      },
    );
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const handle = window.setTimeout(
      () => window.localStorage.setItem(storageKey, JSON.stringify(doc)),
      250,
    );
    return () => window.clearTimeout(handle);
  }, [doc, hydrated, storageKey]);

  const commit = useCallback(
    (update: (current: DesignDocument) => DesignDocument) => {
      setDoc((current) => {
        const next = update(current);
        if (next === current) return current;
        pastRef.current = [...pastRef.current.slice(-49), current];
        futureRef.current = [];
        return next;
      });
    },
    [],
  );

  const updateObject = useCallback(
    (id: string, patch: Partial<DesignObject>, record = true) => {
      const updater = (current: DesignDocument) => ({
        ...current,
        objects: current.objects.map((object) =>
          object.id === id ? ({ ...object, ...patch } as DesignObject) : object,
        ),
      });
      if (record) commit(updater);
      else setDoc(updater);
    },
    [commit],
  );

  const addObject = (
    type: DesignObjectType,
    image?: Pick<DesignImageObject, "src" | "name">,
  ) => {
    const cascade = (doc.objects.length % 8) * 28;
    const x = Math.max(24, Math.round(doc.width / 2 - 180 + cascade));
    const y = Math.max(24, Math.round(doc.height / 2 - 80 + cascade));
    const object = createDesignObject(type, x, y, image);
    commit((current) => ({
      ...current,
      objects: [...current.objects, object],
    }));
    selectOnly(object.id);
  };

  const addUploadedImage = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadReferenceImage(file);
      addObject("image", {
        src: "/api/upload?key=" + encodeURIComponent(uploaded.key),
        name: file.name,
      });
    } finally {
      setUploading(false);
    }
  };

  const removeSelected = useCallback(() => {
    const ids = new Set(
      selectedObjects
        .filter((object) => !object.locked)
        .map((object) => object.id),
    );
    if (ids.size === 0) return;
    commit((current) => ({
      ...current,
      objects: current.objects.filter((object) => !ids.has(object.id)),
    }));
    selectOnly(null);
  }, [commit, selectOnly, selectedObjects]);

  const duplicateSelected = useCallback(() => {
    const editableObjects = selectedObjects.filter((object) => !object.locked);
    if (editableObjects.length === 0) return;
    const copies = editableObjects.map(
      (object) =>
        ({
          ...object,
          id: nextDesignId(object.type),
          name: `${object.name} 副本`,
          x: object.x + 24,
          y: object.y + 24,
        }) as DesignObject,
    );
    commit((current) => ({
      ...current,
      objects: [...current.objects, ...copies],
    }));
    setSelectedIds(copies.map((object) => object.id));
    setSelectedId(copies.at(-1)?.id ?? null);
  }, [commit, selectedObjects]);

  const alignSelection = useCallback(
    (
      mode:
        | "left"
        | "hcenter"
        | "right"
        | "top"
        | "vcenter"
        | "bottom"
        | "distribute-x"
        | "distribute-y",
    ) => {
      const objects = docRef.current.objects.filter(
        (object) => selectedIds.includes(object.id) && !object.locked,
      );
      const bounds = getObjectBounds(objects);
      if (!bounds || objects.length < 2) return;
      const patches = new Map<string, Partial<DesignObject>>();
      for (const object of objects) {
        if (mode === "left") patches.set(object.id, { x: bounds.x });
        if (mode === "hcenter")
          patches.set(object.id, {
            x: bounds.x + (bounds.width - object.width) / 2,
          });
        if (mode === "right")
          patches.set(object.id, {
            x: bounds.x + bounds.width - object.width,
          });
        if (mode === "top") patches.set(object.id, { y: bounds.y });
        if (mode === "vcenter")
          patches.set(object.id, {
            y: bounds.y + (bounds.height - object.height) / 2,
          });
        if (mode === "bottom")
          patches.set(object.id, {
            y: bounds.y + bounds.height - object.height,
          });
      }
      if (mode === "distribute-x" && objects.length > 2) {
        const ordered = [...objects].sort((a, b) => a.x - b.x);
        const totalWidth = ordered.reduce(
          (sum, object) => sum + object.width,
          0,
        );
        const gap = (bounds.width - totalWidth) / (ordered.length - 1);
        let x = bounds.x;
        for (const object of ordered) {
          patches.set(object.id, { x });
          x += object.width + gap;
        }
      }
      if (mode === "distribute-y" && objects.length > 2) {
        const ordered = [...objects].sort((a, b) => a.y - b.y);
        const totalHeight = ordered.reduce(
          (sum, object) => sum + object.height,
          0,
        );
        const gap = (bounds.height - totalHeight) / (ordered.length - 1);
        let y = bounds.y;
        for (const object of ordered) {
          patches.set(object.id, { y });
          y += object.height + gap;
        }
      }
      commit((current) => ({
        ...current,
        objects: current.objects.map((object) => {
          const patch = patches.get(object.id);
          return patch ? ({ ...object, ...patch } as DesignObject) : object;
        }),
      }));
    },
    [commit, selectedIds],
  );

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [docRef.current, ...futureRef.current];
    setDoc(previous);
    selectOnly(null);
  }, [selectOnly]);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, docRef.current];
    setDoc(next);
    selectOnly(null);
  }, [selectOnly]);

  const beginTransform = () => {
    transformStartRef.current = docRef.current;
  };

  const finishTransform = () => {
    const start = transformStartRef.current;
    transformStartRef.current = null;
    if (!start || start === docRef.current) return;
    pastRef.current = [...pastRef.current.slice(-49), start];
    futureRef.current = [];
    setHistoryRevision((value) => value + 1);
  };

  const startMove = (event: React.MouseEvent, object: DesignObject) => {
    if (
      event.button !== 0 ||
      activeTool !== "select" ||
      object.locked ||
      editingTextId === object.id ||
      spacePressed
    )
      return;
    event.stopPropagation();
    event.preventDefault();
    if (event.shiftKey) {
      toggleSelection(object.id);
      return;
    }
    if (!selectedIds.includes(object.id)) selectOnly(object.id);
    beginTransform();
    const objects = selectedIds.includes(object.id)
      ? docRef.current.objects.filter(
          (candidate) =>
            selectedIds.includes(candidate.id) && !candidate.locked,
        )
      : [object];
    interactionRef.current = {
      type: "move",
      startX: event.clientX,
      startY: event.clientY,
      object,
      objects,
    };
  };

  const startCanvasAction = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || spacePressed) return;
    if (activeTool === "select") {
      if (event.target !== event.currentTarget) return;
      const artboard = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - artboard.left) / zoom;
      const y = (event.clientY - artboard.top) / zoom;
      selectOnly(null);
      selectionStartRef.current = { x, y };
      setSelectionMarquee({ x, y, width: 0, height: 0 });
      return;
    }

    event.preventDefault();
    const artboard = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(doc.width, (event.clientX - artboard.left) / zoom),
    );
    const y = Math.max(
      0,
      Math.min(doc.height, (event.clientY - artboard.top) / zoom),
    );
    const object = createDesignObject(activeTool, Math.round(x), Math.round(y));

    if (activeTool === "text") {
      object.width = Math.max(80, Math.min(360, doc.width - object.x));
      commit((current) => ({
        ...current,
        objects: [...current.objects, object],
      }));
      selectOnly(object.id);
      setEditingTextId(object.id);
      setActiveTool("select");
      return;
    }

    object.width = Math.max(10, Math.min(160, doc.width - object.x));
    object.height = Math.max(10, Math.min(120, doc.height - object.y));
    transformStartRef.current = docRef.current;
    interactionRef.current = { type: "draw", startX: x, startY: y, object };
    setDoc((current) => ({
      ...current,
      objects: [...current.objects, object],
    }));
    selectOnly(object.id);
  };

  const startResize = (
    event: React.MouseEvent,
    object: DesignObject,
    direction: ResizeDirection,
  ) => {
    if (spacePressed) return;
    event.stopPropagation();
    event.preventDefault();
    beginTransform();
    interactionRef.current = {
      type: "resize",
      direction,
      startX: event.clientX,
      startY: event.clientY,
      object,
    };
  };

  const startRotate = (event: React.MouseEvent, object: DesignObject) => {
    if (spacePressed) return;
    event.stopPropagation();
    event.preventDefault();
    const artboard = workspaceRef.current
      ?.querySelector<HTMLElement>("[data-design-artboard]")
      ?.getBoundingClientRect();
    if (!artboard) return;
    const centerX = artboard.left + (object.x + object.width / 2) * zoom;
    const centerY = artboard.top + (object.y + object.height / 2) * zoom;
    beginTransform();
    interactionRef.current = {
      type: "rotate",
      centerX,
      centerY,
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      object,
    };
  };

  const startPan = (event: React.MouseEvent<HTMLElement>) => {
    const workspace = workspaceRef.current;
    if (!workspace || (event.button !== 1 && !spacePressed)) return false;
    event.preventDefault();
    panStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: workspace.scrollLeft,
      scrollTop: workspace.scrollTop,
    };
    setPanning(true);
    return true;
  };

  const zoomAtPointer = (
    clientX: number,
    clientY: number,
    nextZoom: number,
  ) => {
    const workspace = workspaceRef.current;
    const artboard = workspace?.querySelector<HTMLElement>(
      "[data-design-artboard]",
    );
    if (!workspace || !artboard) return;
    const currentRect = artboard.getBoundingClientRect();
    const localX = (clientX - currentRect.left) / zoom;
    const localY = (clientY - currentRect.top) / zoom;
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      const nextRect = artboard.getBoundingClientRect();
      workspace.scrollLeft += nextRect.left + localX * nextZoom - clientX;
      workspace.scrollTop += nextRect.top + localY * nextZoom - clientY;
    });
  };

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const panStart = panStartRef.current;
      if (panStart && workspaceRef.current) {
        workspaceRef.current.scrollLeft =
          panStart.scrollLeft - (event.clientX - panStart.clientX);
        workspaceRef.current.scrollTop =
          panStart.scrollTop - (event.clientY - panStart.clientY);
        return;
      }
      const selectionStart = selectionStartRef.current;
      if (selectionStart) {
        const artboard = workspaceRef.current
          ?.querySelector<HTMLElement>("[data-design-artboard]")
          ?.getBoundingClientRect();
        if (!artboard) return;
        const currentX = (event.clientX - artboard.left) / zoom;
        const currentY = (event.clientY - artboard.top) / zoom;
        setSelectionMarquee({
          x: Math.min(selectionStart.x, currentX),
          y: Math.min(selectionStart.y, currentY),
          width: Math.abs(currentX - selectionStart.x),
          height: Math.abs(currentY - selectionStart.y),
        });
        return;
      }
      const interaction = interactionRef.current;
      if (!interaction) return;
      if (interaction.type === "draw") {
        const artboard = workspaceRef.current
          ?.querySelector<HTMLElement>("[data-design-artboard]")
          ?.getBoundingClientRect();
        if (!artboard) return;
        const currentX = (event.clientX - artboard.left) / zoom;
        const currentY = (event.clientY - artboard.top) / zoom;
        let deltaX = currentX - interaction.startX;
        let deltaY = currentY - interaction.startY;
        if (event.shiftKey) {
          const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
          deltaX = Math.sign(deltaX || 1) * size;
          deltaY = Math.sign(deltaY || 1) * size;
        }
        const x = deltaX < 0 ? interaction.startX + deltaX : interaction.startX;
        const y = deltaY < 0 ? interaction.startY + deltaY : interaction.startY;
        updateObject(
          interaction.object.id,
          {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(1, Math.round(Math.abs(deltaX))),
            height: Math.max(1, Math.round(Math.abs(deltaY))),
          },
          false,
        );
        return;
      }
      if (interaction.type === "rotate") {
        const angle = Math.atan2(
          event.clientY - interaction.centerY,
          event.clientX - interaction.centerX,
        );
        updateObject(
          interaction.object.id,
          {
            rotation: (() => {
              const next =
                interaction.object.rotation +
                ((angle - interaction.startAngle) * 180) / Math.PI;
              return Math.round(
                event.shiftKey ? Math.round(next / 15) * 15 : next,
              );
            })(),
          },
          false,
        );
        return;
      }
      let dx = (event.clientX - interaction.startX) / zoom;
      let dy = (event.clientY - interaction.startY) / zoom;
      if (interaction.type === "move") {
        if (event.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const movingIds = new Set(
          interaction.objects.map((candidate) => candidate.id),
        );
        const snapDocument = {
          ...docRef.current,
          objects: docRef.current.objects.filter(
            (candidate) =>
              !movingIds.has(candidate.id) ||
              candidate.id === interaction.object.id,
          ),
        };
        const snapped = snapObjectPosition(
          snapDocument,
          interaction.object,
          interaction.object.x + dx,
          interaction.object.y + dy,
          6 / zoom,
        );
        setSnapGuides(snapped.guides);
        const snappedDx = snapped.x - interaction.object.x;
        const snappedDy = snapped.y - interaction.object.y;
        setDoc((current) => ({
          ...current,
          objects: current.objects.map((candidate) => {
            const initial = interaction.objects.find(
              (item) => item.id === candidate.id,
            );
            if (!movingIds.has(candidate.id) || !initial) return candidate;
            return {
              ...candidate,
              x: Math.round(initial.x + snappedDx),
              y: Math.round(initial.y + snappedDy),
            } as DesignObject;
          }),
        }));
        return;
      }
      const { object, direction } = interaction;
      let x = object.x;
      let y = object.y;
      let width = object.width;
      let height = object.height;
      if (direction.includes("e")) width = Math.max(10, object.width + dx);
      if (direction.includes("s")) height = Math.max(10, object.height + dy);
      if (direction.includes("w")) {
        width = Math.max(10, object.width - dx);
        x = object.x + object.width - width;
      }
      if (direction.includes("n")) {
        height = Math.max(10, object.height - dy);
        y = object.y + object.height - height;
      }
      if (event.shiftKey) {
        const horizontal = direction === "e" || direction === "w";
        const vertical = direction === "n" || direction === "s";
        const scale = horizontal
          ? width / object.width
          : vertical
            ? height / object.height
            : Math.abs(dx / object.width) >= Math.abs(dy / object.height)
              ? width / object.width
              : height / object.height;
        width = Math.max(10, object.width * scale);
        height = Math.max(10, object.height * scale);
        if (direction.includes("w")) x = object.x + object.width - width;
        if (direction.includes("n")) y = object.y + object.height - height;
      }
      updateObject(
        object.id,
        {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        },
        false,
      );
    };
    const onMouseUp = () => {
      if (panStartRef.current) {
        panStartRef.current = null;
        interactionRef.current = null;
        transformStartRef.current = null;
        setSnapGuides(EMPTY_GUIDES);
        setPanning(false);
        return;
      }
      if (selectionStartRef.current) {
        selectionStartRef.current = null;
        setSelectionMarquee((marquee) => {
          if (marquee && marquee.width > 2 && marquee.height > 2) {
            const ids = docRef.current.objects
              .filter(
                (object) =>
                  object.visible &&
                  !object.locked &&
                  intersectsBounds(object, marquee),
              )
              .map((object) => object.id);
            setSelectedIds(ids);
            setSelectedId(ids.at(-1) ?? null);
          }
          return null;
        });
        return;
      }
      if (!interactionRef.current) return;
      const completedInteraction = interactionRef.current;
      interactionRef.current = null;
      setSnapGuides(EMPTY_GUIDES);
      finishTransform();
      if (completedInteraction.type === "draw") setActiveTool("select");
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [updateObject, zoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = (event.target as HTMLElement | null)?.closest(
        "input,textarea,[contenteditable='true']",
      );
      if (editing) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const tool = (
          { v: "select", t: "text", r: "rect", o: "ellipse" } as const
        )[event.key.toLowerCase() as "v" | "t" | "r" | "o"];
        if (tool) {
          event.preventDefault();
          setEditingTextId(null);
          setActiveTool(tool);
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const ids = docRef.current.objects
          .filter((object) => object.visible && !object.locked)
          .map((object) => object.id);
        setSelectedIds(ids);
        setSelectedId(ids.at(-1) ?? null);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        clipboardRef.current = docRef.current.objects.filter(
          (object) => selectedIds.includes(object.id) && !object.locked,
        );
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        if (clipboardRef.current.length === 0) return;
        event.preventDefault();
        const pasted = clipboardRef.current.map(
          (object) =>
            ({
              ...object,
              id: nextDesignId(object.type),
              name: `${object.name} 副本`,
              x: object.x + 24,
              y: object.y + 24,
            }) as DesignObject,
        );
        clipboardRef.current = pasted;
        commit((current) => ({
          ...current,
          objects: [...current.objects, ...pasted],
        }));
        const ids = pasted.map((object) => object.id);
        setSelectedIds(ids);
        setSelectedId(ids.at(-1) ?? null);
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
      }
      if (event.key === "Escape") {
        setEditingTextId(null);
        setActiveTool("select");
        selectOnly(null);
      }
      if (
        selectedObjects.some((object) => !object.locked) &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        const dx =
          event.key === "ArrowLeft"
            ? -distance
            : event.key === "ArrowRight"
              ? distance
              : 0;
        const dy =
          event.key === "ArrowUp"
            ? -distance
            : event.key === "ArrowDown"
              ? distance
              : 0;
        const ids = new Set(selectedIds);
        commit((current) => ({
          ...current,
          objects: current.objects.map((object) =>
            ids.has(object.id) && !object.locked
              ? ({
                  ...object,
                  x: object.x + dx,
                  y: object.y + dy,
                } as DesignObject)
              : object,
          ),
        }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    duplicateSelected,
    commit,
    redo,
    removeSelected,
    selectOnly,
    selected,
    selectedIds,
    selectedObjects,
    undo,
    updateObject,
  ]);

  const fitCanvas = useCallback(() => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    setZoom(
      Math.max(
        MIN_ZOOM,
        Math.min(
          0.9,
          (rect.width - 120) / doc.width,
          (rect.height - 120) / doc.height,
        ),
      ),
    );
  }, [doc.height, doc.width]);

  useEffect(() => {
    if (hydrated) fitCanvas();
  }, [fitCanvas, hydrated]);

  const submitExport = async (format: "svg" | "png") => {
    setExporting(format);
    setExportError(null);
    try {
      const url = URL.createObjectURL(await renderDocument(doc, format));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${doc.name.trim() || "design"}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : format.toUpperCase() + " 导出失败，请重试",
      );
    } finally {
      setExporting(null);
    }
  };

  const publishToInspiration = async () => {
    if (!doc.objects.some((object) => object.visible)) {
      setExportError("画板还是空的，请先添加可见内容再发布");
      return;
    }

    setPublishing(true);
    setExportError(null);
    try {
      const blob = await renderDocument(doc, "png");
      const file = new File(
        [blob],
        `${doc.name.trim().slice(0, 80) || "canvas-design"}.png`,
        { type: "image/png" },
      );
      const uploaded = await uploadReferenceImage(file);
      const token = savePublishPreload(
        buildCanvasPublishPreload({
          document: doc,
          selectedObjects,
          sourceKey: uploaded.key,
          mimeType: "image/png",
        }),
      );
      router.push(`/app/publish?preload=${encodeURIComponent(token)}`);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "无法将画板发送到发布器，请重试",
      );
    } finally {
      setPublishing(false);
    }
  };

  const historyImages = useMemo(
    () =>
      generations
        .flatMap((generation) =>
          generation.images.map((image) => ({
            id: image.id,
            src: image.thumbnailUrl || image.url,
            name: generation.prompt || "生成图片",
          })),
        )
        .filter((image) => image.src),
    [generations],
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1 md:h-12 md:flex-nowrap md:gap-2 md:overflow-x-auto md:px-3 md:py-0">
        <Input
          value={doc.name}
          aria-label="设计名称"
          onChange={(event) =>
            setDoc((current) => ({ ...current, name: event.target.value }))
          }
          className="h-8 w-24 border-transparent bg-transparent px-2 text-sm font-medium hover:border-border focus:border-border sm:w-44"
        />
        <span className="h-5 w-px bg-border" />
        <ToolButton
          title="选择 (V)"
          icon={MousePointer2}
          active={activeTool === "select"}
          onClick={() => setActiveTool("select")}
        />
        <ToolButton
          title="文字 (T)"
          icon={Type}
          active={activeTool === "text"}
          onClick={() => setActiveTool("text")}
        />
        <ToolButton
          title="矩形 (R)"
          icon={RectangleHorizontal}
          active={activeTool === "rect"}
          onClick={() => setActiveTool("rect")}
        />
        <ToolButton
          title="椭圆 (O)"
          icon={Circle}
          active={activeTool === "ellipse"}
          onClick={() => setActiveTool("ellipse")}
        />
        <label
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-foreground"
          title="上传图片"
        >
          <ImagePlus size={15} className={uploading ? "animate-pulse" : ""} />
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addUploadedImage(file);
              event.target.value = "";
            }}
          />
        </label>
        <span className="h-5 w-px bg-border" />
        <ToolButton
          title={showGrid ? "隐藏网格" : "显示网格"}
          icon={LayoutGrid}
          active={showGrid}
          onClick={() => setShowGrid((value) => !value)}
        />
        <ToolButton
          title="撤销"
          icon={Undo2}
          disabled={pastRef.current.length === 0}
          onClick={undo}
        />
        <ToolButton
          title="重做"
          icon={Redo2}
          disabled={futureRef.current.length === 0}
          onClick={redo}
        />
        <span className="lg:hidden">
          <ToolButton
            title="图层与素材"
            icon={PanelsTopLeft}
            active={mobilePanel === "left"}
            onClick={() =>
              setMobilePanel((value) => (value === "left" ? null : "left"))
            }
          />
        </span>
        <span className="xl:hidden">
          <ToolButton
            title="设计属性"
            icon={SlidersHorizontal}
            active={mobilePanel === "right"}
            onClick={() =>
              setMobilePanel((value) => (value === "right" ? null : "right"))
            }
          />
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => void publishToInspiration()}
            disabled={exporting !== null || publishing || !hydrated}
            className="h-8 bg-brand px-3 text-xs font-medium text-on-accent hover:bg-brand/90"
            title="将整张画板和选中的文字带到灵感圈发布器"
          >
            {publishing ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Share2 size={13} />
            )}{" "}
            {publishing ? "准备中…" : "发灵感"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void submitExport("svg")}
            disabled={exporting !== null || publishing}
            className="h-8 px-2 text-xs"
          >
            {exporting === "svg" ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}{" "}
            SVG
          </Button>
          <Button
            variant="ghost"
            onClick={() => void submitExport("png")}
            disabled={exporting !== null || publishing}
            className="h-8 px-2 text-xs"
          >
            {exporting === "png" ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}{" "}
            PNG
          </Button>
        </div>
      </header>

      {exportError ? (
        <div className="border-b border-danger/20 bg-danger/5 px-3 py-1.5 text-center text-xs text-danger">
          {exportError}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {!hydrated ? (
          <div className="absolute inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-brand" />
              正在恢复设计
            </div>
          </div>
        ) : null}
        <aside
          className={cn(
            "absolute inset-y-0 left-0 z-30 w-60 shrink-0 flex-col border-r border-border bg-background shadow-lg lg:relative lg:z-auto lg:flex lg:shadow-none",
            mobilePanel === "left" ? "flex" : "hidden",
          )}
        >
          <div className="grid h-10 grid-cols-2 border-b border-border p-1">
            <button
              type="button"
              onClick={() => setLeftTab("layers")}
              className={cn(
                "rounded text-xs",
                leftTab === "layers"
                  ? "bg-surface-2 text-foreground"
                  : "text-text-muted",
              )}
            >
              图层
            </button>
            <button
              type="button"
              onClick={() => setLeftTab("assets")}
              className={cn(
                "rounded text-xs",
                leftTab === "assets"
                  ? "bg-surface-2 text-foreground"
                  : "text-text-muted",
              )}
            >
              素材
            </button>
          </div>
          {leftTab === "layers" ? (
            <div className="flex-1 overflow-y-auto py-2">
              {[...doc.objects].reverse().map((object) => {
                const Icon = objectIcon(object.type);
                return (
                  <div
                    key={object.id}
                    draggable
                    onDragStart={(event) => {
                      setDraggedLayerId(object.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDraggedLayerId(null)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!draggedLayerId || draggedLayerId === object.id)
                        return;
                      commit((current) => {
                        const dragged = current.objects.find(
                          (candidate) => candidate.id === draggedLayerId,
                        );
                        if (!dragged) return current;
                        const without = current.objects.filter(
                          (candidate) => candidate.id !== draggedLayerId,
                        );
                        const targetIndex = without.findIndex(
                          (candidate) => candidate.id === object.id,
                        );
                        without.splice(targetIndex + 1, 0, dragged);
                        return { ...current, objects: without };
                      });
                      setDraggedLayerId(null);
                    }}
                    onClick={(event) => {
                      if (event.shiftKey) toggleSelection(object.id);
                      else selectOnly(object.id);
                    }}
                    className={cn(
                      "group flex h-9 cursor-default items-center gap-2 px-3 text-xs",
                      selectedIds.includes(object.id)
                        ? "bg-brand/10 text-foreground"
                        : "text-text-muted hover:bg-surface-2",
                    )}
                  >
                    <GripVertical
                      size={12}
                      className="shrink-0 text-text-faint opacity-0 group-hover:opacity-100"
                    />
                    <Icon size={13} />
                    <span className="min-w-0 flex-1 truncate">
                      {object.name}
                    </span>
                    <button
                      type="button"
                      title={object.visible ? "隐藏" : "显示"}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateObject(object.id, { visible: !object.visible });
                      }}
                    >
                      {object.visible ? (
                        <Eye size={12} />
                      ) : (
                        <EyeOff size={12} />
                      )}
                    </button>
                    <button
                      type="button"
                      title={object.locked ? "解锁" : "锁定"}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateObject(object.id, { locked: !object.locked });
                      }}
                    >
                      {object.locked ? (
                        <Lock size={12} />
                      ) : (
                        <Unlock size={12} />
                      )}
                    </button>
                  </div>
                );
              })}
              {doc.objects.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs leading-5 text-text-faint">
                  从顶部工具栏添加文字、形状或图片
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid flex-1 auto-rows-max grid-cols-2 gap-2 overflow-y-auto p-2">
              {historyImages.map((image) => (
                <button
                  type="button"
                  key={image.id}
                  title="添加到画板"
                  onClick={() => addObject("image", image)}
                  className="overflow-hidden rounded border border-border hover:border-brand"
                >
                  <img
                    src={image.src}
                    alt={image.name}
                    className="aspect-square w-full object-cover"
                  />
                </button>
              ))}
              {historyImages.length === 0 ? (
                <p className="col-span-2 py-8 text-center text-xs text-text-faint">
                  暂无生成素材
                </p>
              ) : null}
            </div>
          )}
          <div className="border-t border-border p-3">
            <p className="mb-2 text-[10px] font-medium text-text-faint">画板</p>
            <Select
              aria-label="画板预设"
              controlSize="sm"
              value={
                ARTBOARD_PRESETS.find(
                  (preset) =>
                    preset.width === doc.width && preset.height === doc.height,
                )?.value ?? "custom"
              }
              onValueChange={(value) => {
                const preset = ARTBOARD_PRESETS.find(
                  (candidate) => candidate.value === value,
                );
                if (!preset) return;
                commit((current) => ({
                  ...current,
                  width: preset.width,
                  height: preset.height,
                }));
              }}
              options={[
                ...ARTBOARD_PRESETS.map((preset) => ({
                  value: preset.value,
                  label: preset.label,
                })),
                { value: "custom", label: "自定义尺寸" },
              ]}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField
                label="宽"
                value={doc.width}
                onChange={(width) =>
                  commit((current) => ({
                    ...current,
                    width: clampArtboardDimension(width, current.height),
                  }))
                }
              />
              <NumberField
                label="高"
                value={doc.height}
                onChange={(height) =>
                  commit((current) => ({
                    ...current,
                    height: clampArtboardDimension(height, current.width),
                  }))
                }
              />
            </div>
            <label className="mt-2 flex items-center justify-between text-xs text-text-muted">
              背景{" "}
              <input
                type="color"
                value={doc.background}
                onChange={(event) =>
                  commit((current) => ({
                    ...current,
                    background: event.target.value,
                  }))
                }
                className="h-7 w-10 rounded border border-border bg-transparent"
              />
            </label>
          </div>
        </aside>

        <main
          ref={workspaceRef}
          onMouseDown={(event) => {
            if (startPan(event)) return;
            if (event.target === event.currentTarget) selectOnly(null);
          }}
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            const factor = Math.exp(-event.deltaY * 0.002);
            const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
            zoomAtPointer(event.clientX, event.clientY, next);
          }}
          className={cn(
            "relative min-w-0 flex-1 overflow-auto bg-surface-2",
            activeTool !== "select" && "cursor-crosshair",
            (spacePressed || panning) && "cursor-grab",
            panning && "cursor-grabbing select-none",
          )}
        >
          <div className="flex min-h-full min-w-full items-center justify-center p-16">
            <div
              style={{ width: doc.width * zoom, height: doc.height * zoom }}
              className="relative shrink-0"
            >
              <div
                data-design-artboard
                style={{
                  width: doc.width,
                  height: doc.height,
                  background: doc.background,
                  backgroundImage: showGrid
                    ? "linear-gradient(to right, rgb(var(--border) / 0.5) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--border) / 0.5) 1px, transparent 1px)"
                    : undefined,
                  backgroundSize: showGrid ? "20px 20px" : undefined,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
                className="absolute left-0 top-0 overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.16)]"
                onMouseDown={startCanvasAction}
              >
                {doc.objects.map((object) => (
                  <DesignObjectView
                    key={object.id}
                    object={object}
                    editing={editingTextId === object.id}
                    onMouseDown={(event) => startMove(event, object)}
                    onEditStart={() => {
                      if (object.type !== "text" || object.locked) return;
                      setSelectedId(object.id);
                      setEditingTextId(object.id);
                    }}
                    onEditEnd={() => setEditingTextId(null)}
                    onTextChange={(text) =>
                      updateObject(object.id, { text } as Partial<DesignObject>)
                    }
                  />
                ))}
                <SmartGuides
                  guides={snapGuides}
                  width={doc.width}
                  height={doc.height}
                />
                {selectionMarquee ? (
                  <span
                    data-selection-marquee
                    style={{
                      position: "absolute",
                      left: selectionMarquee.x,
                      top: selectionMarquee.y,
                      width: selectionMarquee.width,
                      height: selectionMarquee.height,
                      border: `${1 / zoom}px solid rgb(var(--brand))`,
                      background: "rgb(var(--brand) / 0.08)",
                      pointerEvents: "none",
                      zIndex: 100001,
                    }}
                  />
                ) : null}
                {selectedObjects.length === 1 &&
                selected &&
                !selected.locked &&
                selected.visible &&
                editingTextId !== selected.id ? (
                  <SelectionControls
                    object={selected}
                    zoom={zoom}
                    onMoveStart={(event) => startMove(event, selected)}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (selected.type === "text") {
                        setEditingTextId(selected.id);
                      }
                    }}
                    onResizeStart={(event, direction) =>
                      startResize(event, selected, direction)
                    }
                    onRotateStart={(event) => startRotate(event, selected)}
                  />
                ) : null}
                {selectedObjects.length > 1 && multiSelectionBounds ? (
                  <MultiSelectionControls
                    bounds={multiSelectionBounds}
                    zoom={zoom}
                    onMoveStart={(event) => {
                      const movable = selectedObjects.find(
                        (object) => !object.locked,
                      );
                      if (!movable) return;
                      startMove(event, movable);
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
          <div className="absolute bottom-4 left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-background px-1 shadow-md">
            <ToolButton
              title="缩小"
              icon={ZoomOut}
              onClick={() =>
                setZoom((value) => Math.max(MIN_ZOOM, value - 0.1))
              }
            />
            <button
              type="button"
              onClick={fitCanvas}
              className="min-w-14 px-1 text-[11px] tabular-nums text-text-muted"
            >
              {Math.round(zoom * 100)}%
            </button>
            <ToolButton
              title="放大"
              icon={ZoomIn}
              onClick={() =>
                setZoom((value) => Math.min(MAX_ZOOM, value + 0.1))
              }
            />
            <ToolButton title="适配画板" icon={RotateCcw} onClick={fitCanvas} />
          </div>
        </main>

        <aside
          className={cn(
            "absolute inset-y-0 right-0 z-30 w-64 shrink-0 overflow-y-auto border-l border-border bg-background shadow-lg xl:relative xl:z-auto xl:block xl:shadow-none",
            mobilePanel === "right" ? "block" : "hidden",
          )}
        >
          {selectedObjects.length > 1 ? (
            <MultiPropertiesPanel
              count={selectedObjects.length}
              canDistribute={selectedObjects.length > 2}
              onAlign={alignSelection}
              onDuplicate={duplicateSelected}
              onDelete={removeSelected}
            />
          ) : selected?.locked ? (
            <LockedPropertiesPanel
              object={selected}
              onUnlock={() => updateObject(selected.id, { locked: false })}
            />
          ) : selected ? (
            <PropertiesPanel
              object={selected}
              onChange={(patch) => updateObject(selected.id, patch)}
              onDuplicate={duplicateSelected}
              onDelete={removeSelected}
              onLayer={(direction) =>
                commit((current) => {
                  const objects = current.objects.filter(
                    (object) => object.id !== selected.id,
                  );
                  return {
                    ...current,
                    objects:
                      direction === "front"
                        ? [...objects, selected]
                        : [selected, ...objects],
                  };
                })
              }
              onCenter={() =>
                updateObject(selected.id, {
                  x: Math.round((doc.width - selected.width) / 2),
                  y: Math.round((doc.height - selected.height) / 2),
                })
              }
            />
          ) : (
            <div className="p-4">
              <p className="text-xs font-medium">设计属性</p>
              <p className="mt-2 text-xs leading-5 text-text-faint">
                选择画板中的对象以编辑位置、尺寸和样式。
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ToolButton({
  title,
  icon: Icon,
  onClick,
  active,
  disabled,
}: {
  title: string;
  icon: typeof Type;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md p-0 text-text-muted hover:bg-surface-2 hover:text-foreground",
        active && "bg-surface-2 text-foreground",
      )}
    >
      <Icon size={15} />
    </Button>
  );
}

function DesignObjectView({
  object,
  editing,
  onMouseDown,
  onEditStart,
  onEditEnd,
  onTextChange,
}: {
  object: DesignObject;
  editing: boolean;
  onMouseDown: (event: React.MouseEvent) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  onTextChange: (text: string) => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing || !textRef.current) return;
    textRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(textRef.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);

  if (!object.visible) return null;
  const style: React.CSSProperties = {
    position: "absolute",
    left: object.x,
    top: object.y,
    width: object.width,
    height: object.height,
    transform: `rotate(${object.rotation}deg)`,
    opacity: object.opacity,
    cursor: object.locked ? "default" : editing ? "text" : "move",
    userSelect: editing ? "text" : "none",
  };
  if (object.type === "text")
    return (
      <div
        ref={textRef}
        data-design-object={object.id}
        style={{
          ...style,
          color: object.color,
          fontSize: object.fontSize,
          fontWeight: object.fontWeight,
          textAlign: object.align,
          lineHeight: 1.2,
          whiteSpace: "pre-wrap",
          overflow: "hidden",
        }}
        onMouseDown={onMouseDown}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onEditStart();
        }}
        contentEditable={editing}
        suppressContentEditableWarning
        onBlur={(event) => {
          onTextChange(event.currentTarget.textContent ?? "");
          onEditEnd();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
      >
        {object.text}
      </div>
    );
  if (object.type === "image")
    return (
      <div
        data-design-object={object.id}
        style={{ ...style, overflow: "hidden", borderRadius: object.radius }}
        onMouseDown={onMouseDown}
      >
        <img
          src={object.src}
          alt={object.name}
          draggable={false}
          className="h-full w-full"
          style={{ objectFit: object.fit }}
        />
      </div>
    );
  return (
    <div
      data-design-object={object.id}
      style={{
        ...style,
        borderRadius: object.type === "ellipse" ? "50%" : object.radius,
        background: object.fill,
        border: `${object.strokeWidth}px solid ${object.stroke}`,
      }}
      onMouseDown={onMouseDown}
    />
  );
}

function SmartGuides({
  guides,
  width,
  height,
}: {
  guides: SnapGuides;
  width: number;
  height: number;
}) {
  return (
    <>
      {guides.x !== null ? (
        <span
          data-snap-guide="vertical"
          style={{
            position: "absolute",
            left: guides.x,
            top: 0,
            width: 1,
            height,
            background: "#ec4899",
            pointerEvents: "none",
            zIndex: 99999,
          }}
        />
      ) : null}
      {guides.y !== null ? (
        <span
          data-snap-guide="horizontal"
          style={{
            position: "absolute",
            left: 0,
            top: guides.y,
            width,
            height: 1,
            background: "#ec4899",
            pointerEvents: "none",
            zIndex: 99999,
          }}
        />
      ) : null}
    </>
  );
}

function MultiSelectionControls({
  bounds,
  zoom,
  onMoveStart,
}: {
  bounds: DesignBounds;
  zoom: number;
  onMoveStart: (event: React.MouseEvent) => void;
}) {
  return (
    <div
      data-design-multi-selection
      onMouseDown={onMoveStart}
      style={{
        position: "absolute",
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        outline: `${1.5 / zoom}px solid rgb(var(--brand))`,
        cursor: "move",
        zIndex: 100000,
      }}
    />
  );
}

function LockedPropertiesPanel({
  object,
  onUnlock,
}: {
  object: DesignObject;
  onUnlock: () => void;
}) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <Lock size={14} className="text-text-faint" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium">
          {object.name}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={onUnlock}
        className="mt-4 h-8 w-full text-xs"
      >
        <Unlock size={13} />
        解锁图层
      </Button>
    </div>
  );
}

type AlignmentMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "distribute-x"
  | "distribute-y";

function MultiPropertiesPanel({
  count,
  canDistribute,
  onAlign,
  onDuplicate,
  onDelete,
}: {
  count: number;
  canDistribute: boolean;
  onAlign: (mode: AlignmentMode) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="divide-y divide-border">
      <section className="p-3">
        <p className="text-xs font-medium">已选择 {count} 个对象</p>
      </section>
      <section className="p-3">
        <p className="mb-2 text-[10px] font-medium text-text-faint">对齐</p>
        <div className="grid grid-cols-4 gap-1">
          <ToolButton
            title="左对齐"
            icon={AlignHorizontalJustifyStart}
            onClick={() => onAlign("left")}
          />
          <ToolButton
            title="水平居中"
            icon={AlignHorizontalJustifyCenter}
            onClick={() => onAlign("hcenter")}
          />
          <ToolButton
            title="右对齐"
            icon={AlignHorizontalJustifyEnd}
            onClick={() => onAlign("right")}
          />
          <ToolButton
            title="顶部对齐"
            icon={AlignVerticalJustifyStart}
            onClick={() => onAlign("top")}
          />
          <ToolButton
            title="垂直居中"
            icon={AlignVerticalJustifyCenter}
            onClick={() => onAlign("vcenter")}
          />
          <ToolButton
            title="底部对齐"
            icon={AlignVerticalJustifyEnd}
            onClick={() => onAlign("bottom")}
          />
          <ToolButton
            title="水平分布"
            icon={AlignHorizontalDistributeCenter}
            disabled={!canDistribute}
            onClick={() => onAlign("distribute-x")}
          />
          <ToolButton
            title="垂直分布"
            icon={AlignVerticalDistributeCenter}
            disabled={!canDistribute}
            onClick={() => onAlign("distribute-y")}
          />
        </div>
      </section>
      <section className="flex gap-1 p-3">
        <ToolButton title="复制选区" icon={Copy} onClick={onDuplicate} />
        <ToolButton title="删除选区" icon={Trash2} onClick={onDelete} />
      </section>
    </div>
  );
}

const RESIZE_HANDLES: Array<{
  direction: ResizeDirection;
  left: string;
  top: string;
  cursor: string;
}> = [
  { direction: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
  { direction: "n", left: "50%", top: "0%", cursor: "ns-resize" },
  { direction: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
  { direction: "w", left: "0%", top: "50%", cursor: "ew-resize" },
  { direction: "e", left: "100%", top: "50%", cursor: "ew-resize" },
  { direction: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
  { direction: "s", left: "50%", top: "100%", cursor: "ns-resize" },
  { direction: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
];

function SelectionControls({
  object,
  zoom,
  onMoveStart,
  onDoubleClick,
  onResizeStart,
  onRotateStart,
}: {
  object: DesignObject;
  zoom: number;
  onMoveStart: (event: React.MouseEvent) => void;
  onDoubleClick: (event: React.MouseEvent) => void;
  onResizeStart: (event: React.MouseEvent, direction: ResizeDirection) => void;
  onRotateStart: (event: React.MouseEvent) => void;
}) {
  const handleSize = 10 / zoom;
  return (
    <div
      data-design-selection
      onMouseDown={onMoveStart}
      onDoubleClick={onDoubleClick}
      style={{
        position: "absolute",
        left: object.x,
        top: object.y,
        width: object.width,
        height: object.height,
        transform: `rotate(${object.rotation}deg)`,
        outline: `${1.5 / zoom}px solid rgb(var(--brand))`,
        cursor: "move",
        pointerEvents: "auto",
        zIndex: 100000,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: -28 / zoom,
          width: 1.5 / zoom,
          height: 28 / zoom,
          background: "rgb(var(--brand))",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      />
      <button
        type="button"
        aria-label="旋转对象"
        title="旋转"
        onMouseDown={onRotateStart}
        style={{
          position: "absolute",
          left: "50%",
          top: -34 / zoom,
          width: handleSize,
          height: handleSize,
          borderRadius: "50%",
          border: `${1.5 / zoom}px solid rgb(var(--brand))`,
          background: "rgb(var(--background))",
          transform: "translate(-50%, -50%)",
          cursor: "grab",
        }}
      />
      {RESIZE_HANDLES.map((handle) => (
        <button
          key={handle.direction}
          type="button"
          aria-label={`调整对象 ${handle.direction}`}
          onMouseDown={(event) => onResizeStart(event, handle.direction)}
          style={{
            position: "absolute",
            left: handle.left,
            top: handle.top,
            width: handleSize,
            height: handleSize,
            border: `${1.5 / zoom}px solid rgb(var(--brand))`,
            background: "rgb(var(--background))",
            transform: "translate(-50%, -50%)",
            cursor: handle.cursor,
          }}
        />
      ))}
    </div>
  );
}

function PropertiesPanel({
  object,
  onChange,
  onDuplicate,
  onDelete,
  onLayer,
  onCenter,
}: {
  object: DesignObject;
  onChange: (patch: Partial<DesignObject>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLayer: (direction: "front" | "back") => void;
  onCenter: () => void;
}) {
  return (
    <div className="divide-y divide-border">
      <section className="space-y-2 p-3">
        <Input
          value={object.name}
          aria-label="图层名称"
          onChange={(event) => onChange({ name: event.target.value })}
          className="h-8 text-xs"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField
            label="X"
            value={object.x}
            onChange={(x) => onChange({ x })}
          />
          <NumberField
            label="Y"
            value={object.y}
            onChange={(y) => onChange({ y })}
          />
          <NumberField
            label="W"
            value={object.width}
            onChange={(width) => onChange({ width: Math.max(10, width) })}
          />
          <NumberField
            label="H"
            value={object.height}
            onChange={(height) => onChange({ height: Math.max(10, height) })}
          />
        </div>
        <NumberField
          label="旋转"
          value={object.rotation}
          onChange={(rotation) => onChange({ rotation })}
        />
        <label className="flex items-center gap-2 text-xs text-text-muted">
          透明度{" "}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={object.opacity}
            onChange={(event) =>
              onChange({ opacity: Number(event.target.value) })
            }
            className="min-w-0 flex-1"
          />
          <span className="w-8 text-right tabular-nums">
            {Math.round(object.opacity * 100)}
          </span>
        </label>
      </section>
      {object.type === "text" ? (
        <section className="space-y-2 p-3">
          <Textarea
            value={object.text}
            rows={3}
            onChange={(event) =>
              onChange({ text: event.target.value } as Partial<DesignObject>)
            }
            className="resize-none text-xs"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField
              label="字号"
              value={object.fontSize}
              onChange={(fontSize) =>
                onChange({ fontSize } as Partial<DesignObject>)
              }
            />
            <NumberField
              label="字重"
              value={object.fontWeight}
              onChange={(fontWeight) =>
                onChange({ fontWeight } as Partial<DesignObject>)
              }
            />
          </div>
          <label className="flex items-center justify-between text-xs text-text-muted">
            颜色{" "}
            <input
              type="color"
              value={object.color}
              onChange={(event) =>
                onChange({ color: event.target.value } as Partial<DesignObject>)
              }
              className="h-7 w-10"
            />
          </label>
          <Select
            aria-label="文字对齐"
            controlSize="sm"
            value={object.align}
            onValueChange={(align) =>
              onChange({ align } as Partial<DesignObject>)
            }
            options={[
              { value: "left", label: "左对齐" },
              { value: "center", label: "居中" },
              { value: "right", label: "右对齐" },
            ]}
          />
        </section>
      ) : null}
      {object.type === "rect" || object.type === "ellipse" ? (
        <section className="space-y-2 p-3">
          <label className="flex items-center justify-between text-xs text-text-muted">
            填充{" "}
            <input
              type="color"
              value={object.fill}
              onChange={(event) =>
                onChange({ fill: event.target.value } as Partial<DesignObject>)
              }
              className="h-7 w-10"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-text-muted">
            描边{" "}
            <input
              type="color"
              value={object.stroke}
              onChange={(event) =>
                onChange({
                  stroke: event.target.value,
                } as Partial<DesignObject>)
              }
              className="h-7 w-10"
            />
          </label>
          <NumberField
            label="描边"
            value={object.strokeWidth}
            onChange={(strokeWidth) =>
              onChange({ strokeWidth } as Partial<DesignObject>)
            }
          />
          {object.type === "rect" ? (
            <NumberField
              label="圆角"
              value={object.radius}
              onChange={(radius) =>
                onChange({ radius } as Partial<DesignObject>)
              }
            />
          ) : null}
        </section>
      ) : null}
      {object.type === "image" ? (
        <section className="space-y-2 p-3">
          <Select
            aria-label="图片适配"
            controlSize="sm"
            value={object.fit}
            onValueChange={(fit) => onChange({ fit } as Partial<DesignObject>)}
            options={[
              { value: "cover", label: "填充画框" },
              { value: "contain", label: "完整显示" },
            ]}
          />
          <NumberField
            label="圆角"
            value={object.radius}
            onChange={(radius) => onChange({ radius } as Partial<DesignObject>)}
          />
        </section>
      ) : null}
      <section className="grid grid-cols-4 gap-1 p-3">
        <ToolButton title="水平居中" icon={AlignCenter} onClick={onCenter} />
        <ToolButton
          title="置于顶层"
          icon={BringToFront}
          onClick={() => onLayer("front")}
        />
        <ToolButton
          title="置于底层"
          icon={SendToBack}
          onClick={() => onLayer("back")}
        />
        <ToolButton title="复制" icon={Copy} onClick={onDuplicate} />
        <ToolButton title="删除" icon={Trash2} onClick={onDelete} />
      </section>
    </div>
  );
}
