"use client";

import { useEffect, useState } from "react";
import {
  Code2,
  Download,
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
  PanelRightOpen,
  X,
} from "lucide-react";
import {
  IconButton,
  Dialog,
  DialogContent,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipProvider,
  useToast,
} from "@/components/ui";
import { buildHtmlPreviewDocument } from "@/lib/html-preview";
import { CopyTextButton } from "../CopyTextButton";
import { cn } from "@/lib/utils";
import styles from "./AssistantContent.module.css";

export {
  buildHtmlPreviewDocument,
  HTML_PREVIEW_CSP,
  isEmbeddedRasterImage,
} from "@/lib/html-preview";

export function HtmlArtifact({
  source,
  streaming = false,
  messageStatus,
  onOpenInPanel,
  variant = "inline",
}: {
  source: string;
  streaming?: boolean;
  messageStatus?: string;
  onOpenInPanel?: () => void;
  variant?: "inline" | "panel";
}) {
  const { toast } = useToast();
  const [view, setView] = useState("preview");
  const [fragmentPreview, setFragmentPreview] = useState(false);
  const complete = messageStatus === "completed" && !streaming;
  const active =
    streaming || messageStatus === "queued" || messageStatus === "running";
  const selectedView =
    active || (!complete && !fragmentPreview) ? "source" : view;
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<{
    source: string;
    document: string;
  } | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    if (active || (!complete && !fragmentPreview)) return;
    try {
      setPreview({ source, document: buildHtmlPreviewDocument(source) });
      setFailedSource(null);
    } catch {
      setFailedSource(source);
    }
  }, [source, active, complete, fragmentPreview]);
  const previewDocument =
    !active && (complete || fragmentPreview) && preview?.source === source
      ? preview.document
      : null;

  const download = () => {
    if (!previewDocument) return;
    try {
      // Downloads retain the same static, offline policy as the preview.
      const url = URL.createObjectURL(
        new Blob([previewDocument], { type: "text/html;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "chugao-artifact.html";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast({ title: "HTML 下载失败", variant: "danger" });
    }
  };

  const openPreview = () => {
    if (onOpenInPanel) onOpenInPanel();
    else setExpanded(true);
  };

  return (
    <TooltipProvider delayDuration={250}>
      {variant === "inline" ? (
        <div className={styles.artifactLauncher} aria-label="HTML 产物">
          <span className={styles.launcherIcon} aria-hidden>
            {active ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Code2 size={18} />
            )}
          </span>
          <span className={styles.launcherBody}>
            <strong className={styles.launcherTitle}>
              {active ? "HTML 产物 · 生成中" : "HTML 产物"}
            </strong>
            <span className={styles.launcherMeta}>
              {active ? "正在准备预览" : "打开右侧查看完整预览"}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <Tooltip content="复制 HTML 源码">
              <span className="inline-flex">
                <CopyTextButton text={source} label="复制 HTML 源码" />
              </span>
            </Tooltip>
            <Tooltip content="下载静态 HTML">
              <IconButton
                aria-label="下载静态 HTML"
                disabled={!previewDocument}
                onClick={download}
                className="h-9 w-9"
              >
                <Download size={15} />
              </IconButton>
            </Tooltip>
            <Tooltip content="打开预览">
              <IconButton
                aria-label="打开 HTML 预览"
                disabled={!previewDocument}
                onClick={openPreview}
                className="h-9 w-9"
              >
                <PanelRightOpen size={16} />
              </IconButton>
            </Tooltip>
          </span>
        </div>
      ) : (
        <Tabs
          value={selectedView}
          onValueChange={(value) => {
            setView(value);
            setFragmentPreview(value === "preview");
          }}
          className={cn(
            styles.artifact,
            variant === "panel" && styles.artifactPanel,
          )}
          aria-label="HTML 文档"
          aria-busy={active || undefined}
        >
          <div className={styles.toolbar}>
            <span className={styles.language}>
              {complete ? "HTML 预览" : "HTML 预览 · 生成中"}
            </span>
            <TabsList
              aria-label="HTML 视图"
              className="shrink-0 [&_button]:h-11 sm:[&_button]:h-9"
            >
              <Tooltip content={complete ? "预览" : "预览未完成片段"}>
                <TabsTrigger
                  value="preview"
                  disabled={active}
                  aria-label={complete ? "预览 HTML" : "预览未完成 HTML 片段"}
                  className="inline-flex items-center gap-1.5 px-3"
                >
                  <Eye size={16} aria-hidden />
                  <span className="hidden sm:inline">预览</span>
                </TabsTrigger>
              </Tooltip>
              <Tooltip content="源码">
                <TabsTrigger
                  value="source"
                  aria-label="查看 HTML 源码"
                  className="inline-flex items-center gap-1.5 px-3"
                >
                  <Code2 size={16} aria-hidden />
                  <span className="hidden sm:inline">源码</span>
                </TabsTrigger>
              </Tooltip>
            </TabsList>
            <div className="ml-auto flex shrink-0 items-center">
              <Tooltip content="复制 HTML 源码">
                <span className="inline-flex">
                  <CopyTextButton text={source} label="复制 HTML 源码" />
                </span>
              </Tooltip>
              <Tooltip content="下载净化后的静态 HTML">
                <IconButton
                  aria-label="下载静态 HTML"
                  disabled={!previewDocument}
                  onClick={download}
                  className="h-11 w-11 sm:h-9 sm:w-9"
                >
                  <Download size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip content={expanded ? "收起预览" : "放大预览"}>
                <IconButton
                  aria-label={expanded ? "收起预览" : "放大预览"}
                  aria-pressed={expanded}
                  onClick={() => setExpanded((value) => !value)}
                  disabled={!previewDocument || selectedView !== "preview"}
                  className="h-11 w-11 sm:h-9 sm:w-9"
                >
                  {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </IconButton>
              </Tooltip>
            </div>
          </div>
          {!complete ? (
            <p role="status" className="px-3 py-2 text-xs text-text-muted">
              未完成{selectedView === "preview" ? "片段预览" : "源码"}
            </p>
          ) : null}
          <TabsContent value="preview" className={styles.preview}>
            {previewDocument ? (
              <iframe
                title="HTML 预览"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={previewDocument}
                className={styles.frame}
              />
            ) : failedSource === source ? (
              <p role="alert" className="p-4 text-sm text-danger">
                HTML 预览失败
              </p>
            ) : (
              <div
                className="flex h-full items-center justify-center"
                role="status"
                aria-label="正在准备 HTML 预览"
              >
                <Loader2 size={18} className="animate-spin text-text-muted" />
              </div>
            )}
          </TabsContent>
          <TabsContent value="source">
            <pre className={styles.source} tabIndex={0} aria-label="HTML 源码">
              <code>{source}</code>
            </pre>
          </TabsContent>
        </Tabs>
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          hideClose
          aria-describedby={undefined}
          className="studio-workspace w-[calc(100vw-24px)] max-w-6xl overflow-hidden p-0"
        >
          <div className="flex h-14 items-center gap-2 border-b border-border px-3">
            <DialogTitle className="min-w-0 flex-1 text-sm font-medium tracking-normal">
              {complete ? "HTML 预览" : "未完成 HTML 片段预览"}
            </DialogTitle>
            <IconButton
              aria-label="下载静态 HTML"
              title="下载净化后的静态 HTML"
              disabled={!previewDocument}
              onClick={download}
              className="h-11 w-11 border-transparent bg-transparent"
            >
              <Download size={16} />
            </IconButton>
            <IconButton
              aria-label="关闭预览"
              title="关闭预览"
              onClick={() => setExpanded(false)}
              className="h-11 w-11 border-transparent bg-transparent"
            >
              <X size={16} />
            </IconButton>
          </div>
          {previewDocument ? (
            <iframe
              title="HTML 放大预览"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={previewDocument}
              className="block h-[calc(100dvh-120px)] min-h-40 w-full border-0 bg-white"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
