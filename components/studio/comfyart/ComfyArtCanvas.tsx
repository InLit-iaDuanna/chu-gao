"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  createShapeId,
  useValue,
  type Editor,
  type TLAssetStore,
  type TLComponents,
  type TLShape,
} from "tldraw";
import {
  Check,
  Copy,
  Download,
  FileUp,
  Frame,
  ImagePlus,
  Layers,
  Maximize2,
  LoaderCircle,
  MessageSquare,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button, IconButton, Select, useToast } from "@/components/ui";
import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { listModels as registryModels } from "@/lib/models/registry";
import {
  cancelGeneration,
  createGeneration,
  getGeneration,
  getMe,
  listGenerations,
  listModels,
  uploadReferenceImage,
} from "../lib/api";
import { subscribeGeneration } from "../lib/sse";
import {
  isActiveStatus,
  type Generation,
  type Me,
  type ModelInfo,
} from "../lib/types";
import { GenerationPanel } from "./GenerationPanel";
import { CanvasLayers } from "./CanvasLayers";
import { ArtboardShapeUtil, exportImage } from "./vendor/ArtboardShape";
import {
  DoodleShapeUtil,
  DoodleTool,
  DOODLE,
  doodleColorAtom,
  doodleSizeAtom,
} from "./vendor/DoodleShape";
import {
  CommentShapeUtil,
  CommentTool,
  COMMENT,
  commentKindAtom,
  type CommentKind,
} from "./vendor/CommentShape";
import {
  downloadBlob,
  generationPosition,
  placeGeneration,
  placeImage,
  readJobs,
  writeJobs,
  uploadUrl,
  readPendingJobs,
  persistPendingJobs,
  type CanvasDraft,
  type CanvasJob,
} from "./canvas-bridge";

const assetUrls = getAssetUrls({ baseUrl: "/comfyart-assets" });
const shapeUtils = [ArtboardShapeUtil, DoodleShapeUtil, CommentShapeUtil];
const tools = [DoodleTool, CommentTool];
const components: TLComponents = { SharePanel: null };
const overrides = {
  translations: {
    "zh-cn": {
      "shortcuts-dialog.disabled-notice": "键盘快捷键已关闭",
      "comments.link-copied": "批注链接已复制",
    },
  },
};
const assetStore: TLAssetStore = {
  async upload(_asset, file) {
    const image = await uploadReferenceImage(file);
    return { src: uploadUrl(image.key) };
  },
  resolve(asset) {
    return asset.props.src;
  },
};
const getShapeVisibility = (shape: TLShape) =>
  shape.meta.hidden ? ("hidden" as const) : ("inherit" as const);

const previewModels: ModelInfo[] = registryModels().map((model) => ({
  ...model,
  pricingRules: undefined,
  available: true,
}));
const previewUser: Me = {
  id: "canvas-local-preview",
  email: "preview@dev.local",
  name: "Preview",
  role: "USER",
  status: "ACTIVE",
  credits: 0,
  dailyGenLimit: 0,
  concurrentLimit: 0,
  dailyUsed: 0,
  dailyLimit: 0,
  authenticated: true,
};
const noRefresh = () => undefined;

export function ComfyArtPreview() {
  return (
    <CanvasWorkspace
      user={previewUser}
      models={previewModels}
      history={[]}
      onRefresh={noRefresh}
    />
  );
}

export default function ComfyArtCanvas({
  licenseKey,
}: {
  licenseKey?: string;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [history, setHistory] = useState<Generation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    setError(null);
    const [user, modelList, generations] = await Promise.allSettled([
      getMe(),
      listModels(),
      listGenerations({ limit: 24 }),
    ]);
    if (user.status === "fulfilled") setMe(user.value);
    else setError("无法读取登录账户，请重新加载");
    if (modelList.status === "fulfilled") setModels(modelList.value);
    if (generations.status === "fulfilled") setHistory(generations.value.items);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!me)
    return (
      <div
        className="flex h-full items-center justify-center gap-2 text-sm text-text-muted"
        role="status"
      >
        {loaded ? (
          <>
            <span>{error}</span>
            <Button size="sm" onClick={() => void refresh()}>
              重新加载
            </Button>
          </>
        ) : (
          <>
            <LoaderCircle size={16} className="animate-spin" />
            正在载入画布
          </>
        )}
      </div>
    );
  return (
    <CanvasWorkspace
      key={me.id}
      user={me}
      models={models}
      history={history}
      onRefresh={() => void refresh()}
      licenseKey={licenseKey}
    />
  );
}

export function CanvasWorkspace({
  user,
  models,
  history,
  onRefresh,
  licenseKey,
}: {
  user: Me;
  models: ModelInfo[];
  history: Generation[];
  onRefresh: () => void;
  licenseKey?: string;
}) {
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [panel, setPanel] = useState<"generate" | "layers" | "history">(
    "generate",
  );
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1024);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [commentKind, setCommentKind] = useState<CommentKind>("box");
  const [brushColor, setBrushColor] = useState("#dc8c27");
  const [brushSize, setBrushSize] = useState(6);
  const [importing, setImporting] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const streams = useRef(new Map<string, () => void>());
  const mounted = useRef(true);
  const error = useCallback(
    (message: string) => toast({ title: message, variant: "danger" }),
    [toast],
  );
  const state = useValue(
    "chugao canvas",
    () =>
      editor
        ? {
            selected: editor.getSelectedShapeIds(),
            pageId: editor.getCurrentPageId(),
            tool: editor.getCurrentToolId(),
            jobs: readJobs(editor),
            shapeCount: editor.getCurrentPageShapeIds().size,
          }
        : null,
    [editor],
  );

  useEffect(() => {
    mounted.current = true;
    const subscriptions = streams.current;
    return () => {
      mounted.current = false;
      for (const close of subscriptions.values()) close();
      subscriptions.clear();
    };
  }, []);
  useEffect(() => {
    if (editor)
      editor.user.updateUserPreferences({
        colorScheme: resolvedTheme === "dark" ? "dark" : "light",
        locale: "zh-cn",
        isSnapMode: true,
      });
  }, [editor, resolvedTheme]);

  const trackJob = useCallback(
    (ed: Editor, job: CanvasJob) => {
      if (streams.current.has(job.id)) return;
      const apply = (generation: Generation) => {
        if (!mounted.current) return;
        setProgress((current) => ({
          ...current,
          [job.id]: generation.progress,
        }));
        if (isActiveStatus(generation.status)) return;
        if (generation.status === "SUCCEEDED") {
          try {
            const ids = placeGeneration(ed, generation, job);
            if (ed.getCurrentPageId() === job.pageId && ids.length)
              ed.select(...ids).zoomToSelection();
          } catch (cause) {
            error(cause instanceof Error ? cause.message : "图片放置失败");
            return;
          }
        } else if (generation.status === "FAILED") {
          error(
            friendlyErrorMessage(
              {
                code: generation.errorCode || undefined,
                message: generation.errorMessage || undefined,
              },
              "图片生成失败",
            ),
          );
        }
        const pending = readJobs(ed).filter((item) => item.id !== job.id);
        writeJobs(ed, pending);
        try {
          persistPendingJobs(
            user.id,
            readPendingJobs(user.id).filter((item) => item.id !== job.id),
          );
        } catch {
          /* Document persistence remains available. */
        }
        streams.current.get(job.id)?.();
        streams.current.delete(job.id);
        onRefresh();
      };
      streams.current.set(job.id, () => undefined);
      void getGeneration(job.id)
        .then((generation) => {
          if (!mounted.current) return;
          apply(generation);
          if (!isActiveStatus(generation.status)) return;
          const close = subscribeGeneration(job.id, {
            onUpdate: apply,
            onError: (_code, message) => {
              error(message);
              streams.current.delete(job.id);
            },
          });
          if (mounted.current) streams.current.set(job.id, close);
          else close();
        })
        .catch((cause) => {
          streams.current.delete(job.id);
          if (mounted.current)
            error(cause instanceof Error ? cause.message : "任务状态读取失败");
        });
    },
    [error, onRefresh, user.id],
  );

  const onMount = useCallback((ed: Editor) => {
    ed.updateInstanceState({ isGridMode: true });
    ed.setCameraOptions({ wheelBehavior: "pan" });
    setEditor(ed);
  }, []);
  useEffect(() => {
    if (!editor) return;
    const jobs = [
      ...new Map(
        [...readJobs(editor), ...readPendingJobs(user.id)].map((job) => [
          job.id,
          job,
        ]),
      ).values(),
    ];
    if (jobs.length) writeJobs(editor, jobs);
    for (const job of jobs) trackJob(editor, job);
    // Recovery runs once per mounted editor. Later jobs are registered at submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const generate = async (draft: CanvasDraft) => {
    if (!editor || submitting) return;
    setSubmitting(true);
    const position = generationPosition(editor);
    try {
      const result = await createGeneration({
        modelId: draft.modelId,
        prompt: draft.prompt.trim(),
        size: draft.size,
        quality: draft.quality,
        n: draft.n,
        outputFormat: draft.outputFormat,
        background: draft.background,
        referenceImageKeys: draft.references.map((reference) => reference.key),
      });
      const job: CanvasJob = { ...position, id: result.generationId };
      try {
        persistPendingJobs(user.id, [
          ...readPendingJobs(user.id).filter((item) => item.id !== job.id),
          job,
        ]);
      } catch {
        /* The document also records active tasks while it is mounted. */
      }
      if (!mounted.current) return;
      writeJobs(editor, [...readJobs(editor), job]);
      trackJob(editor, job);
      onRefresh();
    } catch (cause) {
      error(cause instanceof Error ? cause.message : "生成任务提交失败");
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };

  const exportCanvas = async (format: "png" | "jpeg" | "svg" | "json") => {
    if (!editor) return;
    setExporting(true);
    try {
      if (format === "json") {
        const snapshot = getSnapshot(editor.store);
        downloadBlob(
          new Blob(
            [
              JSON.stringify({
                format: "chugao-comfyart",
                version: 1,
                snapshot,
              }),
            ],
            { type: "application/json" },
          ),
          "chugao-canvas.json",
        );
      } else {
        const ids = editor.getSelectedShapeIds().length
          ? editor.getSelectedShapeIds()
          : [...editor.getCurrentPageShapeIds()].filter(
              (id) => !editor.getShape(id)?.meta.hidden,
            );
        if (!ids.length) throw new Error("当前画布没有可导出的内容");
        const { blob } = await exportImage(editor, ids, {
          format,
          background: format === "jpeg",
          padding: 0,
          scale: 1,
        });
        downloadBlob(
          blob,
          `chugao-canvas.${format === "jpeg" ? "jpg" : format}`,
        );
      }
    } catch (cause) {
      error(cause instanceof Error ? cause.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const importCanvas = async (file?: File) => {
    if (!editor || !file) return;
    setImporting(true);
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("画布备份不能超过 20MB");
      const json = JSON.parse(await file.text());
      if (
        json.format !== "chugao-comfyart" ||
        json.version !== 1 ||
        !json.snapshot?.document
      )
        throw new Error("请选择 Chugao 画布备份文件");
      // Import into a new page/document snapshot only after preserving the current document.
      downloadBlob(
        new Blob(
          [
            JSON.stringify({
              format: "chugao-comfyart",
              version: 1,
              snapshot: getSnapshot(editor.store),
            }),
          ],
          { type: "application/json" },
        ),
        "chugao-before-import.json",
      );
      loadSnapshot(editor.store, json.snapshot);
      editor.zoomToFit();
      for (const job of readJobs(editor)) trackJob(editor, job);
      toast({ title: "画布已导入" });
    } catch (cause) {
      error(cause instanceof Error ? cause.message : "导入失败");
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  };

  const addFrame = () => {
    if (!editor) return;
    const center = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape({
      id,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: center.x - 512,
      y: center.y - 512,
      props: { w: 1024, h: 1024, name: "画板" },
      meta: { style: { fill: "#ffffff" } },
    });
    editor.select(id).zoomToSelection();
  };
  const uploadImages = async (files: FileList | null) => {
    if (!editor || !files) return;
    try {
      for (const [index, file] of Array.from(files).entries()) {
        const saved = await uploadReferenceImage(file);
        const position = generationPosition(editor);
        const id = placeImage(
          editor,
          {
            id: saved.key,
            src: uploadUrl(saved.key),
            url: uploadUrl(saved.key),
            downloadUrl: uploadUrl(saved.key),
            thumbnailUrl: uploadUrl(saved.key),
            width: saved.width,
            height: saved.height,
            mimeType: file.type,
            createdAt: new Date().toISOString(),
          },
          { ...position, x: position.x + index * 672 },
        );
        editor.select(id);
      }
      editor.zoomToSelection();
    } catch (cause) {
      error(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      if (uploadInput.current) uploadInput.current.value = "";
    }
  };
  const usePrompt = (prompt: string) => {
    if (!editor) return;
    const page = editor.getCurrentPage();
    editor.updatePage({
      id: page.id,
      meta: {
        ...page.meta,
        chugaoDraft: { ...((page.meta.chugaoDraft as object) || {}), prompt },
      },
    });
    setPanel("generate");
    setPanelOpen(true);
  };

  return (
    <div
      className="chugao-comfyart flex h-full min-h-0 flex-col"
      data-testid="comfyart-workspace"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <IconButton
          aria-label="添加画板"
          title="添加画板"
          disabled={!editor}
          onClick={addFrame}
        >
          <Frame size={16} />
        </IconButton>
        <IconButton
          aria-label="上传图片到画布"
          title="上传图片到画布"
          disabled={!editor}
          onClick={() => uploadInput.current?.click()}
        >
          <ImagePlus size={16} />
        </IconButton>
        <IconButton
          aria-label="草图画笔"
          title="草图画笔"
          aria-pressed={state?.tool === DOODLE}
          disabled={!editor}
          onClick={() => {
            doodleColorAtom.set(brushColor);
            doodleSizeAtom.set(brushSize);
            editor?.setCurrentTool(DOODLE);
          }}
        >
          <Pencil size={16} />
        </IconButton>
        {state?.tool === DOODLE && (
          <div className="flex items-center gap-1.5 px-1">
            <input
              type="color"
              aria-label="草图颜色"
              title="草图颜色"
              value={brushColor}
              className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent"
              onChange={(event) => {
                setBrushColor(event.target.value);
                doodleColorAtom.set(event.target.value);
              }}
            />
            <input
              type="range"
              aria-label="画笔粗细"
              title="画笔粗细"
              min={1}
              max={24}
              step={1}
              value={brushSize}
              className="hidden w-16 sm:block"
              onChange={(event) => {
                setBrushSize(Number(event.target.value));
                doodleSizeAtom.set(Number(event.target.value));
              }}
            />
          </div>
        )}
        <IconButton
          aria-label="区域批注"
          title="区域批注"
          aria-pressed={state?.tool === COMMENT}
          disabled={!editor}
          onClick={() => {
            commentKindAtom.set(commentKind);
            editor?.setCurrentTool(COMMENT);
            setPanel("layers");
            setPanelOpen(true);
          }}
        >
          <MessageSquare size={16} />
        </IconButton>
        {state?.tool === COMMENT && (
          <div className="hidden w-24 sm:block">
            <Select
              aria-label="批注范围"
              value={commentKind}
              options={[
                { value: "box", label: "框选" },
                { value: "lasso", label: "圈选" },
                { value: "point", label: "标记" },
              ]}
              onValueChange={(value) => {
                setCommentKind(value as CommentKind);
                commentKindAtom.set(value as CommentKind);
              }}
              controlSize="sm"
            />
          </div>
        )}
        <span className="ml-1 hidden min-w-0 truncate text-[11px] text-text-muted lg:block">
          {state?.shapeCount ?? 0} 个图层
        </span>
        <div className="flex-1" />
        <IconButton
          aria-label="适应画布"
          title="适应画布"
          disabled={!editor || !state?.shapeCount}
          onClick={() => editor?.zoomToFit()}
        >
          <Maximize2 size={16} />
        </IconButton>
        <IconButton
          aria-label="导入画布备份"
          title="导入画布备份"
          disabled={
            !editor || importing || submitting || Boolean(state?.jobs.length)
          }
          onClick={() => importInput.current?.click()}
        >
          <FileUp size={16} />
        </IconButton>
        <div className="w-24 sm:w-28">
          <Select
            aria-label="导出画布"
            placeholder="导出"
            value=""
            disabled={!editor || exporting}
            controlSize="sm"
            options={[
              { value: "png", label: "PNG 图片" },
              { value: "jpeg", label: "JPG 图片" },
              { value: "svg", label: "SVG 图片" },
              { value: "json", label: "画布备份" },
            ]}
            onValueChange={(value) =>
              void exportCanvas(value as "png" | "jpeg" | "svg" | "json")
            }
          />
        </div>
        <Link
          href="/app/nodes"
          aria-label="打开旧节点画布"
          title="旧节点画布"
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-2 sm:inline-flex"
        >
          <Network size={16} />
        </Link>
        <IconButton
          aria-label={panelOpen ? "收起画布面板" : "展开画布面板"}
          title={panelOpen ? "收起画布面板" : "展开画布面板"}
          onClick={() => setPanelOpen((open) => !open)}
        >
          {panelOpen ? (
            <PanelRightClose size={16} />
          ) : (
            <PanelRightOpen size={16} />
          )}
        </IconButton>
      </div>
      <input
        ref={uploadInput}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void uploadImages(e.target.files)}
      />
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importCanvas(e.target.files?.[0])}
      />
      <div className="relative flex min-h-0 flex-1">
        <div
          className="relative min-h-0 min-w-0 flex-1"
          aria-label="ComfyArt 设计画布"
        >
          <Tldraw
            persistenceKey={`chugao.comfyart.v1.${user.id}`}
            assets={assetStore}
            assetUrls={assetUrls}
            shapeUtils={shapeUtils}
            tools={tools}
            components={components}
            overrides={overrides}
            getShapeVisibility={getShapeVisibility}
            licenseKey={licenseKey}
            onMount={onMount}
          ></Tldraw>
          {!panelOpen && (
            <Button
              className="absolute bottom-24 right-3 z-[400] h-10 shadow-sm"
              variant="primary"
              onClick={() => {
                setPanel("generate");
                setPanelOpen(true);
              }}
            >
              {state?.jobs.length ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  生成中 {state.jobs.length}
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  生成
                </>
              )}
            </Button>
          )}
        </div>
        {panelOpen && editor && state && (
          <aside
            aria-label="画布面板"
            className="canvas-side-panel absolute inset-y-0 right-0 z-[450] flex w-[min(320px,100%)] shrink-0 flex-col border-l border-border bg-surface md:relative md:w-72 xl:w-80"
          >
            <div className="flex h-11 shrink-0 items-center border-b border-border px-2">
              <div
                role="tablist"
                aria-label="画布工具面板"
                className="flex min-w-0 flex-1 gap-1"
              >
                {(
                  [
                    { id: "generate", label: "生成", icon: Sparkles },
                    { id: "layers", label: "图层", icon: Layers },
                    { id: "history", label: "历史", icon: ImagePlus },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={panel === id}
                    className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs ${panel === id ? "bg-surface-3 text-foreground" : "text-text-muted hover:bg-surface-2"}`}
                    onClick={() => setPanel(id)}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>
              <IconButton
                className="h-7 w-7"
                aria-label="关闭画布面板"
                title="关闭画布面板"
                onClick={() => setPanelOpen(false)}
              >
                <X size={14} />
              </IconButton>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              role="tabpanel"
            >
              {panel === "generate" && (
                <GenerationPanel
                  key={state.pageId}
                  pageId={state.pageId}
                  editor={editor}
                  models={models}
                  selectionCount={state.selected.length}
                  submitting={submitting}
                  onGenerate={generate}
                  onError={error}
                />
              )}
              {panel === "layers" && (
                <CanvasLayers editor={editor} onUsePrompt={usePrompt} />
              )}
              {panel === "history" && (
                <div className="p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
                    <span>最近生成</span>
                    <IconButton
                      aria-label="刷新生成历史"
                      title="刷新生成历史"
                      onClick={onRefresh}
                    >
                      <RefreshCw size={14} />
                    </IconButton>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {history.flatMap((generation) =>
                      generation.images.map((image) => (
                        <button
                          type="button"
                          key={image.id}
                          aria-label={`放入画布 ${generation.prompt.slice(0, 24)}`}
                          title={generation.prompt}
                          className="overflow-hidden rounded border border-border bg-surface-2 text-left hover:border-border-strong"
                          onClick={() => {
                            const id = placeImage(
                              editor,
                              image,
                              generationPosition(editor),
                              generation,
                            );
                            editor.select(id).zoomToSelection();
                          }}
                        >
                          <img
                            src={image.thumbnailUrl || image.url}
                            alt={generation.prompt.slice(0, 60)}
                            loading="lazy"
                            className="aspect-square w-full object-contain"
                          />
                        </button>
                      )),
                    )}
                  </div>
                  {!history.some((generation) => generation.images.length) && (
                    <p className="py-8 text-center text-xs text-text-muted">
                      暂无生成图片
                    </p>
                  )}
                </div>
              )}
            </div>
            {state.jobs.length > 0 && (
              <div
                className="space-y-2 border-t border-border p-3"
                role="status"
                aria-live="polite"
              >
                {state.jobs.map((job) => (
                  <div key={job.id} className="flex items-center gap-2 text-xs">
                    <LoaderCircle
                      size={13}
                      className="animate-spin text-brand"
                    />
                    <span className="flex-1">
                      生成中{" "}
                      <span className="tabular-nums">
                        {progress[job.id] || 0}%
                      </span>
                    </span>
                    <IconButton
                      className="h-7 w-7"
                      aria-label="取消生成"
                      title="取消生成"
                      onClick={() =>
                        void cancelGeneration(job.id).catch((cause) =>
                          error(
                            cause instanceof Error ? cause.message : "取消失败",
                          ),
                        )
                      }
                    >
                      <Square size={12} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-t border-border px-4 text-[11px] text-text-muted">
              <Check size={12} />
              <span>本机自动保存</span>
              <span className="ml-auto tabular-nums">{user.credits} 积分</span>
            </div>
          </aside>
        )}
      </div>
      {state && state.selected.length > 1 && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-text-muted">
          <span>{state.selected.length} 个已选</span>
          <IconButton
            className="h-7 w-7"
            aria-label="复制选区"
            title="复制选区"
            onClick={() => editor?.duplicateShapes(state.selected)}
          >
            <Copy size={13} />
          </IconButton>
          <IconButton
            className="h-7 w-7"
            aria-label="删除选区"
            title="删除选区"
            onClick={() => editor?.deleteShapes(state.selected)}
          >
            <Trash2 size={13} />
          </IconButton>
          <IconButton
            className="h-7 w-7"
            aria-label="下载选区"
            title="下载选区"
            onClick={() => void exportCanvas("png")}
          >
            <Download size={13} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
