"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/ui";
import { savePublishPreload } from "@/components/inspiration/publish-preload";

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
import {
  NodeWorkspaceToolbar,
  NodeCanvasStatus,
  NodeOverview,
  type CanvasTool,
  type CanvasTab,
} from "./NodeWorkspaceChrome";

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
  const [tool, setTool] = useState<CanvasTool>("select");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
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

  const measuredNodeHeights = () =>
    new Map(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-node-canvas] [data-node-id]",
        ),
        (element) => [
          element.dataset.nodeId!,
          element.getBoundingClientRect().height / graph.viewport.zoom,
        ],
      ),
    );

  const addNodeAtCenter = (kind: NodeKind) => {
    const heights = measuredNodeHeights();
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
              candidate.y >=
                node.y +
                  (heights.get(node.id) ?? estimatedNodeHeight(node)) +
                  gap
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
    const heights = measuredNodeHeights();
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
      ...graph.nodes.map(
        (node) => node.y + (heights.get(node.id) ?? estimatedNodeHeight(node)),
      ),
    );
    const padding = 56;
    const topInset = 76;
    const bottomInset = 128;
    const zoom = Math.min(
      1.25,
      Math.max(
        0.25,
        Math.min(
          (width - padding * 2) / Math.max(1, maxX - minX),
          (height - topInset - bottomInset) / Math.max(1, maxY - minY),
        ),
      ),
    );
    graphApi.setViewport({
      zoom,
      x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y:
        topInset +
        (height - topInset - bottomInset - (maxY - minY) * zoom) / 2 -
        minY * zoom,
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

  const focusNode = (id: string) => {
    const node = graph.nodes.find((item) => item.id === id);
    const rect = document
      .querySelector<HTMLElement>("[data-node-canvas]")
      ?.getBoundingClientRect();
    if (!node || !rect) return;
    const nodeHeight =
      measuredNodeHeights().get(node.id) ?? estimatedNodeHeight(node);
    const topInset = 76;
    const bottomInset = 128;
    const zoom = Math.min(
      1,
      Math.max(0.25, (rect.height - topInset - bottomInset) / nodeHeight),
      graph.viewport.zoom,
    );
    graphApi.setViewport({
      zoom,
      x: rect.width / 2 - (node.x + NODE_WIDTH / 2) * zoom,
      y:
        topInset +
        Math.max(
          0,
          (rect.height - topInset - bottomInset - nodeHeight * zoom) / 2,
        ) -
        node.y * zoom,
    });
    setFocusRequest((current) => ({
      id,
      version: (current?.version ?? 0) + 1,
    }));
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setOverviewOpen(false);
    }
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
    <div className="relative isolate flex h-full min-h-0 flex-col overflow-hidden">
      <NodeWorkspaceToolbar
        tabs={canvasTabs}
        activeId={activeCanvasId}
        onSelectTab={setActiveCanvasId}
        onCreateTab={createCanvas}
        onCloseTab={closeCanvas}
        onRenameTab={(id, name) =>
          setCanvasTabs((tabs) =>
            tabs.map((tab) => (tab.id === id ? { ...tab, name } : tab)),
          )
        }
        tool={tool}
        onToolChange={setTool}
        onAdd={addNodeAtCenter}
        onUndo={graphApi.undo}
        onRedo={graphApi.redo}
        canUndo={graphApi.canUndo}
        canRedo={graphApi.canRedo}
        onArrange={() => graphApi.autoArrange(measuredNodeHeights())}
        onPublish={handlePublish}
        onClear={() => setClearOpen(true)}
        onRun={handleRunAll}
        readyCount={
          Object.entries(validationHints).filter(
            ([id, hint]) => hint === null && runs[id]?.status !== "running",
          ).length
        }
        runningCount={
          Object.values(runs).filter((run) => run.status === "running").length
        }
        saveState={graphApi.saveState}
        panelOpen={overviewOpen}
        onTogglePanel={() => setOverviewOpen((open) => !open)}
      />

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <NodeCanvas
            key={activeCanvasId}
            tool={tool}
            focusRequest={focusRequest}
            onSelectionChange={setSelectedIds}
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
        {overviewOpen && (
          <NodeOverview
            nodes={graph.nodes}
            runs={runs}
            hints={validationHints}
            selectedIds={selectedIds}
            onFocus={focusNode}
            onClose={() => setOverviewOpen(false)}
          />
        )}
      </div>
      <NodeCanvasStatus
        nodeCount={graph.nodes.length}
        edgeCount={graph.edges.length}
        zoom={graph.viewport.zoom}
        onZoom={zoomBy}
        onFit={fitView}
        onReset={() => zoomBy(1 / graph.viewport.zoom)}
      />

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="studio-workspace p-5">
          <DialogTitle className="tracking-normal">清空当前画布？</DialogTitle>
          <DialogDescription>
            移除当前画布的节点和连线，可通过撤销恢复。其他画布和已生成图片不受影响。
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setClearOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                graphApi.clearGraph();
                setClearOpen(false);
              }}
            >
              清空画布
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
