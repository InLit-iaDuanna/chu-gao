"use client";

import { Button, DropdownMenu, DropdownMenuItem } from "@/components/ui";

import {
  Coins,
  ImagePlus,
  LayoutGrid,
  Maximize2,
  Minus,
  MoreHorizontal,
  Palette,
  Play,
  Plus,
  Redo2,
  Share2,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Frame,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/ui";
import { savePublishPreload } from "@/components/inspiration/publish-preload";
import { cn } from "@/lib/utils";

import {
  cancelGeneration,
  createGeneration,
  getMe,
  isApiError,
  listGenerations,
  listModels,
  uploadReferenceImage,
} from "../lib/api";
import { subscribeGeneration } from "../lib/sse";
import { resolveGenerationOptions } from "../lib/generation-options";
import {
  isActiveStatus,
  type CreateGenerationInput,
  type Generation,
  type Me,
  type ModelInfo,
} from "../lib/types";
import { Lightbox, type LightboxState } from "../Lightbox";
import { NodeCanvas } from "./NodeCanvas";
import { buildNodePublishPreload } from "./node-publish";
import {
  IDLE_RUN,
  estimatedNodeHeight,
  estimatedNodeHeightForKind,
  NODE_WIDTH,
  type GraphNode,
  type NodeKind,
  type NodeRunState,
} from "./node-graph-types";
import { useNodeGraph } from "./useNodeGraph";

const ADD_NODE_ITEMS = [
  { kind: "prompt" as const, label: "提示词", icon: Type },
  { kind: "reference" as const, label: "参考图", icon: ImagePlus },
  { kind: "model" as const, label: "模型与参数", icon: SlidersHorizontal },
  { kind: "generate" as const, label: "生成", icon: Play },
];

const MORE_NODE_ITEMS = [
  { kind: "style" as const, label: "风格预设", icon: Palette },
  { kind: "note" as const, label: "批注", icon: StickyNote },
  { kind: "frame" as const, label: "画板", icon: Frame },
  { kind: "text" as const, label: "文字", icon: Type },
  { kind: "shape" as const, label: "形状", icon: Square },
  { kind: "design-image" as const, label: "设计图片", icon: ImagePlus },
];

interface CanvasTab {
  id: string;
  name: string;
}

const CANVAS_TABS_STORAGE_PREFIX = "chugao.node-canvases.v1";

function newCanvasId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `canvas-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `canvas-${Date.now().toString(36)}`;
}

/** 节点生图：ComfyUI 式节点编排，把图编译为一次生成请求。 */
export function NodesApp() {
  const router = useRouter();
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [history, setHistory] = useState<Generation[]>([]);
  const [runs, setRuns] = useState<Record<string, NodeRunState>>({});
  const [uploads, setUploads] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [canvasTabs, setCanvasTabs] = useState<CanvasTab[]>([
    { id: "main", name: "主画布" },
  ]);
  const [activeCanvasId, setActiveCanvasId] = useState("main");
  const [canvasTabsLoadedFor, setCanvasTabsLoadedFor] = useState<string | null>(
    null,
  );
  const streamsRef = useRef<Map<string, () => void>>(new Map());

  const accountKey = me?.id ?? "anon";
  const graphStorageKey =
    activeCanvasId === "main" ? accountKey : `${accountKey}.${activeCanvasId}`;
  const graphApi = useNodeGraph(graphStorageKey);
  const { graph, hydrated, contentRevision, initializeNodeData } = graphApi;
  const latestGraphRef = useRef(graph);
  latestGraphRef.current = graph;

  const refreshMe = useCallback(() => {
    getMe()
      .then(setMe)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    Promise.allSettled([
      getMe(),
      listModels(),
      listGenerations({ limit: 12 }),
    ]).then(([meResult, modelsResult, historyResult]) => {
      if (meResult.status === "fulfilled") setMe(meResult.value);
      if (modelsResult.status === "fulfilled") setModels(modelsResult.value);
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value.items);
      }
    });

    const streams = streamsRef.current;
    return () => {
      for (const close of streams.values()) close();
      streams.clear();
    };
  }, []);

  useEffect(() => {
    const key = `${CANVAS_TABS_STORAGE_PREFIX}.${accountKey}`;
    let stored: CanvasTab[] = [{ id: "main", name: "主画布" }];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((tab): tab is CanvasTab =>
          Boolean(
            tab &&
            typeof tab.id === "string" &&
            typeof tab.name === "string" &&
            tab.id.length > 0,
          ),
        );
        if (valid.length > 0) stored = valid;
      }
    } catch {
      // 无法读取标签元数据时保留主画布。
    }
    if (!stored.some((tab) => tab.id === "main")) {
      stored = [{ id: "main", name: "主画布" }, ...stored];
    }
    setCanvasTabs(stored);
    setActiveCanvasId("main");
    setCanvasTabsLoadedFor(accountKey);
  }, [accountKey]);

  useEffect(() => {
    if (canvasTabsLoadedFor !== accountKey) return;
    try {
      window.localStorage.setItem(
        `${CANVAS_TABS_STORAGE_PREFIX}.${accountKey}`,
        JSON.stringify(canvasTabs),
      );
    } catch {
      // 标签只作为便利元数据，存储失败不影响当前画布。
    }
  }, [accountKey, canvasTabs, canvasTabsLoadedFor]);

  useEffect(() => {
    setRuns({});
    setLightbox(null);
    for (const close of streamsRef.current.values()) close();
    streamsRef.current.clear();
  }, [activeCanvasId]);

  const setRun = useCallback((nodeId: string, patch: Partial<NodeRunState>) => {
    setRuns((current) => ({
      ...current,
      [nodeId]: { ...(current[nodeId] ?? IDLE_RUN), ...patch },
    }));
  }, []);

  // 图载入后，为缺省模型节点和生成节点填入首选模型。
  useEffect(() => {
    if (!hydrated || models.length === 0) return;
    const preferred = models.find((item) => item.available) ?? models[0];
    for (const node of latestGraphRef.current.nodes) {
      if (node.kind === "model" && !node.data.modelId) {
        initializeNodeData(node.id, { modelId: preferred.id });
      }
      if (node.kind === "generate" && !node.data.modelId) {
        initializeNodeData(node.id, {
          modelId: preferred.id,
          n: node.data.n ?? 1,
          image2Mode: node.data.image2Mode ?? "standard",
          background: node.data.background ?? "auto",
        });
      }
    }
  }, [contentRevision, hydrated, initializeNodeData, models]);

  const track = useCallback(
    (nodeId: string, generationId: string) => {
      if (streamsRef.current.has(nodeId)) return;
      const close = subscribeGeneration(generationId, {
        onUpdate: (generation) => {
          setRun(nodeId, {
            generationId: generation.id,
            status: isActiveStatus(generation.status)
              ? "running"
              : generation.status === "SUCCEEDED"
                ? "succeeded"
                : generation.status === "CANCELED"
                  ? "canceled"
                  : "failed",
            progress: generation.progress,
            images: generation.images.map((image) => ({
              id: image.id,
              url: image.url,
              thumbnailUrl: image.thumbnailUrl,
              downloadUrl: image.downloadUrl || image.url,
            })),
            error: generation.errorMessage,
          });
          if (!isActiveStatus(generation.status)) {
            streamsRef.current.get(nodeId)?.();
            streamsRef.current.delete(nodeId);
            refreshMe();
          }
        },
        onError: (code, message) => {
          streamsRef.current.get(nodeId)?.();
          streamsRef.current.delete(nodeId);
          if (code !== "NOT_FOUND") {
            setRun(nodeId, { status: "failed", error: message });
          }
        },
      });
      streamsRef.current.set(nodeId, close);
    },
    [refreshMe, setRun],
  );

  /** 把一个生成节点及其入边编译为生成请求。 */
  const compileNode = useCallback(
    (nodeId: string): { input: CreateGenerationInput } | { error: string } => {
      const current = latestGraphRef.current;
      const incoming = current.edges.filter((edge) => edge.to === nodeId);
      const nodeOf = (id: string) =>
        current.nodes.find((node) => node.id === id);
      const generateNode = nodeOf(nodeId);
      if (!generateNode || generateNode.kind !== "generate") {
        return { error: "找不到生成节点" };
      }

      const modelEdge = incoming.find((edge) => edge.toPort === "model");
      const modelNode = modelEdge ? nodeOf(modelEdge.from) : undefined;
      const modelId =
        modelNode?.kind === "model"
          ? modelNode.data.modelId
          : generateNode.data.modelId;
      if (!modelId) {
        return { error: "在生成节点中选择模型，或连接一个「模型与参数」节点" };
      }
      const model = models.find((item) => item.id === modelId);
      if (!model) return { error: "在模型节点中选择一个模型" };

      const prompt = incoming
        .filter((edge) => edge.toPort === "prompt")
        .map((edge) => nodeOf(edge.from))
        .filter(
          (node): node is Extract<GraphNode, { kind: "prompt" | "style" }> =>
            node?.kind === "prompt" || node?.kind === "style",
        )
        .map((node) => node.data.text.trim())
        .filter(Boolean)
        .join("\n");

      const qualityEdge = incoming.find((edge) => edge.toPort === "quality");
      const qualityNode = qualityEdge ? nodeOf(qualityEdge.from) : undefined;
      const image2Mode =
        qualityNode?.kind === "quality"
          ? qualityNode.data.image2Mode
          : generateNode.data.image2Mode;
      const supportedQualities = model.capabilities.qualities ?? ["auto"];
      const quality =
        qualityNode?.kind === "quality"
          ? (qualityNode.data.quality ??
            (qualityNode.data.image2Mode === "high" ? "high" : "medium"))
          : (generateNode.data.quality ??
            model.defaults.quality ??
            supportedQualities[0]);
      const background =
        qualityNode?.kind === "quality"
          ? qualityNode.data.background
          : generateNode.data.background;
      if (
        image2Mode &&
        model.capabilities.image2Modes &&
        !model.capabilities.image2Modes.includes(image2Mode)
      ) {
        return { error: "当前模型不支持所选 Image2 质量" };
      }
      if (!quality || !supportedQualities.some((item) => item === quality)) {
        return { error: "当前模型不支持所选质量档位" };
      }
      if (
        background &&
        !model.capabilities.backgrounds.some((item) => item === background)
      ) {
        return { error: "当前模型不支持所选背景模式" };
      }

      const references = incoming
        .filter((edge) => edge.toPort === "reference")
        .map((edge) => nodeOf(edge.from))
        .filter(
          (node): node is Extract<GraphNode, { kind: "reference" }> =>
            node?.kind === "reference",
        )
        .map((node) => node.data)
        .filter((data) => data.key);

      if (!prompt && references.length === 0) {
        return { error: "至少连接一条提示词或一张参考图" };
      }

      const { size, outputFormat } = resolveGenerationOptions(
        model,
        modelNode?.kind === "model" ? modelNode.data : generateNode.data,
      );

      return {
        input: {
          modelId: model.id,
          prompt: prompt || "以参考图为基础生成",
          size,
          n:
            modelNode?.kind === "model"
              ? modelNode.data.n
              : (generateNode.data.n ?? 1),
          outputFormat,
          quality,
          image2Mode: model.capabilities.image2Modes ? image2Mode : undefined,
          background,
          referenceImageKeys:
            references
              .filter((item) => item.kind === "upload")
              .map((i) => i.key).length > 0
              ? references
                  .filter((item) => item.kind === "upload")
                  .map((i) => i.key)
              : undefined,
          sourceImageIds:
            references
              .filter((item) => item.kind === "source")
              .map((i) => i.key).length > 0
              ? references
                  .filter((item) => item.kind === "source")
                  .map((i) => i.key)
              : undefined,
        },
      };
    },
    [models],
  );

  // 每个生成节点的禁用原因（画布实时显示）。
  const validationHints = useMemo(() => {
    void contentRevision;
    const hints: Record<string, string | null> = {};
    for (const node of latestGraphRef.current.nodes) {
      if (node.kind !== "generate") continue;
      const result = compileNode(node.id);
      hints[node.id] = "error" in result ? result.error : null;
    }
    return hints;
  }, [compileNode, contentRevision]);

  const handleRun = useCallback(
    async (nodeId: string) => {
      const compiled = compileNode(nodeId);
      if ("error" in compiled) {
        toast({ title: "节点未就绪", description: compiled.error });
        return;
      }
      if ((runs[nodeId] ?? IDLE_RUN).status === "running") return;

      setRun(nodeId, {
        status: "running",
        progress: 2,
        images: [],
        error: null,
      });
      try {
        const result = await createGeneration(compiled.input);
        setRun(nodeId, { generationId: result.generationId });
        track(nodeId, result.generationId);
        refreshMe();
      } catch (error) {
        setRun(nodeId, {
          status: "failed",
          error: isApiError(error) ? error.message : "提交失败，请稍后重试",
        });
      }
    },
    [compileNode, refreshMe, runs, setRun, toast, track],
  );

  const handleRunAll = useCallback(() => {
    for (const node of graph.nodes) {
      if (node.kind !== "generate") continue;
      if ((runs[node.id] ?? IDLE_RUN).status === "running") continue;
      if ("error" in compileNode(node.id)) continue;
      void handleRun(node.id);
    }
  }, [compileNode, graph.nodes, handleRun, runs]);

  const handlePublish = useCallback(() => {
    const preload = buildNodePublishPreload(graph, runs);
    if (!preload) {
      toast({
        title: "还没有可发布的结果",
        description: "请先运行至少一个生成节点，并等待图片生成完成。",
      });
      return;
    }
    try {
      const token = savePublishPreload(preload);
      router.push(`/app/publish?preload=${encodeURIComponent(token)}`);
    } catch (error) {
      toast({
        title: "无法打开发布器",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    }
  }, [graph, router, runs, toast]);

  const handleCancel = useCallback(
    async (nodeId: string) => {
      const run = runs[nodeId];
      if (!run?.generationId) return;
      try {
        await cancelGeneration(run.generationId);
        setRun(nodeId, { status: "canceled" });
        streamsRef.current.get(nodeId)?.();
        streamsRef.current.delete(nodeId);
        refreshMe();
      } catch (error) {
        toast({
          title: "取消失败",
          description: isApiError(error) ? error.message : "请稍后重试",
          variant: "danger",
        });
      }
    },
    [refreshMe, runs, setRun, toast],
  );

  const handleUploadFile = useCallback(
    async (nodeId: string, file: File) => {
      setUploads((current) => ({ ...current, [nodeId]: true }));
      try {
        const uploaded = await uploadReferenceImage(file);
        graphApi.updateNodeData(nodeId, {
          kind: "upload",
          key: uploaded.key,
          previewUrl: URL.createObjectURL(file),
        });
      } catch (error) {
        toast({
          title: "上传失败",
          description: isApiError(error) ? error.message : "请稍后重试",
          variant: "danger",
        });
      } finally {
        setUploads((current) => ({ ...current, [nodeId]: false }));
      }
    },
    [graphApi, toast],
  );

  const handleDropFiles = useCallback(
    (files: File[], position: { x: number; y: number }) => {
      for (const [index, file] of files.slice(0, 8).entries()) {
        const nodeId = graphApi.addNode("reference", {
          x: position.x + (index % 3) * 276,
          y: position.y + Math.floor(index / 3) * 170,
        });
        void handleUploadFile(nodeId, file);
      }
    },
    [graphApi, handleUploadFile],
  );

  /** 结果图 → 新建参考图节点并接回当前生成节点（ComfyUI 式迭代）。 */
  const handleResultAsReference = useCallback(
    (
      nodeId: string,
      image: { id: string; url: string; thumbnailUrl: string },
    ) => {
      const generateNode = graph.nodes.find((node) => node.id === nodeId);
      if (!generateNode) return;
      const newId = graphApi.addNode(
        "reference",
        { x: generateNode.x - 300, y: generateNode.y + 220 },
        {
          kind: "source",
          key: image.id,
          previewUrl: image.url || image.thumbnailUrl,
        },
      );
      graphApi.connect(newId, nodeId, "reference");
    },
    [graph.nodes, graphApi],
  );

  const handleResultAsDesignImage = useCallback(
    (
      nodeId: string,
      image: { id: string; url: string; thumbnailUrl: string },
    ) => {
      const source = graph.nodes.find((node) => node.id === nodeId);
      if (!source) return;
      graphApi.addNode(
        "design-image",
        { x: source.x + NODE_WIDTH + 40, y: source.y },
        {
          url: image.url || image.thumbnailUrl,
          imageId: image.id,
          fit: "cover",
          x: 80,
          y: 80,
          width: 640,
          height: 480,
        },
      );
    },
    [graph.nodes, graphApi],
  );

  const handleOpenImage = useCallback(
    (nodeId: string, index: number) => {
      const run = runs[nodeId];
      if (!run || run.images.length === 0) return;
      setLightbox({
        generation: {
          prompt: "",
          images: run.images.map((image) => ({
            url: image.url,
            downloadUrl: image.downloadUrl || image.url,
          })),
        },
        index,
      });
    },
    [runs],
  );

  const handleDownloadImage = useCallback(
    (image: {
      id: string;
      url: string;
      thumbnailUrl: string;
      downloadUrl?: string;
    }) => {
      const link = document.createElement("a");
      link.href = image.downloadUrl || image.url;
      link.download = `chugao-${image.id}.png`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [],
  );

  const addNodeAtCenter = (kind: NodeKind) => {
    const rect = document
      .querySelector<HTMLElement>("[data-node-canvas]")
      ?.getBoundingClientRect();
    const width = rect?.width ?? Math.max(360, window.innerWidth - 72);
    const height = rect?.height ?? Math.max(320, window.innerHeight - 96);
    const base = {
      x: (width / 2 - graph.viewport.x) / graph.viewport.zoom - NODE_WIDTH / 2,
      y: (height / 2 - graph.viewport.y) / graph.viewport.zoom - 80,
    };
    const nodeHeight = estimatedNodeHeightForKind(kind);
    const offsets: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    for (let radius = 1; radius <= 5; radius += 1) {
      for (let y = -radius; y <= radius; y += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
          offsets.push({ x: x * 276, y: y * 190 });
        }
      }
    }
    const position =
      offsets
        .map((offset) => ({ x: base.x + offset.x, y: base.y + offset.y }))
        .find((candidate) =>
          graph.nodes.every((node) => {
            const gap = 16;
            return (
              candidate.x + NODE_WIDTH + gap <= node.x ||
              candidate.x >= node.x + NODE_WIDTH + gap ||
              candidate.y + nodeHeight + gap <= node.y ||
              candidate.y >= node.y + estimatedNodeHeight(node) + gap
            );
          }),
        ) ?? base;
    graphApi.addNode(kind, position);
  };

  const zoomBy = (factor: number) => {
    const rect = document
      .querySelector<HTMLElement>("[data-node-canvas]")
      ?.getBoundingClientRect();
    const current = graph.viewport;
    const next = Math.min(1.75, Math.max(0.25, current.zoom * factor));
    const cx = (rect?.width ?? window.innerWidth) / 2;
    const cy = (rect?.height ?? window.innerHeight) / 2;
    const scale = next / current.zoom;
    graphApi.setViewport({
      zoom: next,
      x: cx - (cx - current.x) * scale,
      y: cy - (cy - current.y) * scale,
    });
  };

  const fitView = () => {
    if (graph.nodes.length === 0) {
      graphApi.setViewport({ x: 24, y: 16, zoom: 1 });
      return;
    }
    const rect = document
      .querySelector<HTMLElement>("[data-node-canvas]")
      ?.getBoundingClientRect();
    const width = rect?.width ?? Math.max(360, window.innerWidth - 72);
    const height = rect?.height ?? Math.max(320, window.innerHeight - 96);
    const minX = Math.min(...graph.nodes.map((node) => node.x));
    const minY = Math.min(...graph.nodes.map((node) => node.y));
    const maxX = Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH));
    const maxY = Math.max(
      ...graph.nodes.map((node) => node.y + estimatedNodeHeight(node)),
    );
    const padding = 56;
    const zoom = Math.min(
      1.25,
      Math.max(
        0.25,
        Math.min(
          (width - padding * 2) / Math.max(1, maxX - minX),
          (height - padding * 2) / Math.max(1, maxY - minY),
        ),
      ),
    );
    graphApi.setViewport({
      zoom,
      x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (height - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
  };

  const createCanvas = () => {
    const id = newCanvasId();
    const usedNames = new Set(canvasTabs.map((tab) => tab.name));
    let number = canvasTabs.length + 1;
    while (usedNames.has(`画布 ${number}`)) number += 1;
    setCanvasTabs((current) => [...current, { id, name: `画布 ${number}` }]);
    setActiveCanvasId(id);
  };

  const closeCanvas = (id: string) => {
    if (id === "main") return;
    const index = canvasTabs.findIndex((tab) => tab.id === id);
    const next = canvasTabs.filter((tab) => tab.id !== id);
    if (id === activeCanvasId) {
      setActiveCanvasId(next[Math.max(0, index - 1)]?.id ?? "main");
    }
    setCanvasTabs(next.length > 0 ? next : [{ id: "main", name: "主画布" }]);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) graphApi.redo();
      else graphApi.undo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [graphApi]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-3">
        <span className="whitespace-nowrap text-[13px] font-semibold tracking-tight">
          节点生图
        </span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <div className="flex items-center gap-1">
          {ADD_NODE_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                variant="ghost"
                key={item.kind}
                type="button"
                onClick={() => addNodeAtCenter(item.kind)}
                className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                <Icon size={11} />
                {item.label}
              </Button>
            );
          })}
          <DropdownMenu
            className="min-w-44"
            trigger={
              <Button
                variant="ghost"
                type="button"
                className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                <MoreHorizontal size={11} />
                更多节点
              </Button>
            }
          >
            {MORE_NODE_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={item.kind}
                  onClick={() => addNodeAtCenter(item.kind)}
                  className="h-7 text-xs"
                >
                  <Icon size={12} className="text-text-muted" />
                  {item.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenu>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {me ? (
            <span className="mr-1 hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium sm:flex">
              <Coins size={12} className="text-text-muted" />
              <span className="tabular-nums">{me.credits}</span>
            </span>
          ) : null}
          <Button
            variant="ghost"
            type="button"
            onClick={graphApi.undo}
            disabled={!graphApi.canUndo}
            title="撤销"
            aria-label="撤销"
            className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-35"
          >
            <Undo2 size={12} />
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={graphApi.redo}
            disabled={!graphApi.canRedo}
            title="重做"
            aria-label="重做"
            className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-35"
          >
            <Redo2 size={12} />
          </Button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <Button
            variant="ghost"
            type="button"
            onClick={graphApi.autoArrange}
            title="自动整理"
            aria-label="自动整理"
            className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <LayoutGrid size={12} />
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={fitView}
            title="适配全部节点"
            aria-label="适配全部节点"
            className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <Maximize2 size={12} />
          </Button>
          <span className="flex h-7 items-center rounded-md border border-border">
            <Button
              variant="ghost"
              type="button"
              onClick={() => zoomBy(1 / 1.15)}
              title="缩小"
              aria-label="缩小"
              className="flex h-6 w-6 items-center justify-center rounded-[4px] p-0 text-text-muted hover:bg-surface-2 hover:text-foreground"
            >
              <Minus size={11} />
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => graphApi.setViewport({ x: 24, y: 16, zoom: 1 })}
              title="重置为 100%"
              className="h-6 min-w-11 px-1 text-[10px] tabular-nums text-text-muted hover:text-foreground"
            >
              {Math.round(graph.viewport.zoom * 100)}%
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => zoomBy(1.15)}
              title="放大"
              aria-label="放大"
              className="flex h-6 w-6 items-center justify-center rounded-[4px] p-0 text-text-muted hover:bg-surface-2 hover:text-foreground"
            >
              <Plus size={11} />
            </Button>
          </span>
          <Button
            variant="ghost"
            type="button"
            onClick={handlePublish}
            disabled={!graphApi.hydrated}
            title="把已完成的生成结果和工作流说明带到灵感圈"
            className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-foreground disabled:opacity-40"
          >
            <Share2 size={11} />
            发灵感
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={handleRunAll}
            disabled={
              !Object.values(validationHints).some((hint) => hint === null)
            }
            title="运行所有已就绪的生成节点"
            className="flex h-7 items-center gap-1 rounded-md bg-brand px-2 text-[11px] font-medium text-on-accent hover:bg-brand/88 disabled:opacity-40"
          >
            <Play size={11} />
            运行全部
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              if (window.confirm("清空整张节点图？此操作不可撤销。")) {
                graphApi.clearGraph();
                setRuns({});
              }
            }}
            title="清空画布"
            className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-surface-2 hover:text-danger"
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="节点画布"
        className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface/50 px-2"
      >
        {canvasTabs.map((tab) => {
          const active = tab.id === activeCanvasId;
          return (
            <div
              key={tab.id}
              role="presentation"
              className={cn(
                "group flex h-7 shrink-0 items-center rounded-md border transition-colors",
                active
                  ? "border-brand/45 bg-brand/10"
                  : "border-transparent hover:border-border hover:bg-surface-2",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCanvasId(tab.id)}
                onDoubleClick={() => {
                  const next = window.prompt("重命名画布", tab.name)?.trim();
                  if (!next) return;
                  setCanvasTabs((current) =>
                    current.map((item) =>
                      item.id === tab.id ? { ...item, name: next } : item,
                    ),
                  );
                }}
                className={cn(
                  "max-w-32 truncate px-2 text-[11px] outline-none",
                  active ? "text-brand" : "text-text-muted",
                )}
              >
                {tab.name}
              </button>
              {tab.id !== "main" ? (
                <button
                  type="button"
                  aria-label={`关闭${tab.name}`}
                  title={`关闭${tab.name}`}
                  onClick={() => closeCanvas(tab.id)}
                  className="mr-1 flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-surface-2 hover:text-foreground"
                >
                  <X size={11} />
                </button>
              ) : null}
            </div>
          );
        })}
        <Button
          variant="ghost"
          type="button"
          aria-label="新建画布"
          title="新建画布"
          onClick={createCanvas}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <Plus size={12} />
          新建
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <NodeCanvas
          key={activeCanvasId}
          graph={graph}
          models={models}
          history={history}
          runs={runs}
          uploads={uploads}
          validationHints={validationHints}
          onMoveNodes={graphApi.moveNodes}
          onInteractionEnd={graphApi.finishHistoryGroup}
          onUpdateNodeData={graphApi.updateNodeData}
          onDuplicateNode={graphApi.duplicateNode}
          onDuplicateNodes={graphApi.duplicateNodes}
          onRemoveNode={graphApi.removeNode}
          onRemoveNodes={graphApi.removeNodes}
          onConnect={graphApi.connect}
          onReorderReference={graphApi.reorderEdge}
          onDisconnect={graphApi.disconnect}
          onViewportChange={graphApi.setViewport}
          onRun={(nodeId) => void handleRun(nodeId)}
          onCancel={(nodeId) => void handleCancel(nodeId)}
          onUploadFile={(nodeId, file) => void handleUploadFile(nodeId, file)}
          onDropFiles={handleDropFiles}
          onOpenImage={handleOpenImage}
          onResultAsReference={handleResultAsReference}
          onResultAsDesignImage={handleResultAsDesignImage}
          onDownloadImage={handleDownloadImage}
        />
      </div>

      {lightbox ? (
        <Lightbox
          state={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={(index) =>
            setLightbox((current) =>
              current ? { ...current, index } : current,
            )
          }
        />
      ) : null}
    </div>
  );
}
