"use client";

import { useEffect, useState } from "react";
import createDOMPurify from "dompurify";
import {
  Code2,
  Download,
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
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
import { CopyTextButton } from "../CopyTextButton";
import styles from "./AssistantContent.module.css";

export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function isEmbeddedRasterImage(value: string): boolean {
  return /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(
    value,
  );
}

export function buildHtmlPreviewDocument(source: string): string {
  // A template-owned document is inert even during parsing; raw resource URLs never enter the live DOM.
  const owner = document.createElement("template").content.ownerDocument;
  const root = owner.createElement("html");
  root.innerHTML = source;
  const purify = createDOMPurify(window);
  if (!purify.isSupported) throw new Error("HTML sanitization is unavailable");
  purify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "src") {
      data.keepAttr =
        node.nodeName.toLowerCase() === "img" &&
        node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
        isEmbeddedRasterImage(data.attrValue);
    }
  });
  purify.sanitize(root, {
    IN_PLACE: true,
    WHOLE_DOCUMENT: true,
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: [
      "base",
      "link",
      "meta",
      "template",
      "form",
      "audio",
      "video",
      "source",
      "track",
      "animate",
      "set",
    ],
    FORBID_ATTR: [
      "href",
      "xlink:href",
      "srcset",
      "action",
      "formaction",
      "target",
      "ping",
      "background",
      "poster",
      "autofocus",
    ],
    ALLOW_DATA_ATTR: false,
  });
  const head = root.querySelector("head") ?? owner.createElement("head");
  if (!head.parentNode) root.prepend(head);
  const charset = owner.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const policy = owner.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", HTML_PREVIEW_CSP);
  const viewport = owner.createElement("meta");
  viewport.setAttribute("name", "viewport");
  viewport.setAttribute("content", "width=device-width, initial-scale=1");
  const referrer = owner.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  const defaults = owner.createElement("style");
  defaults.textContent =
    "html{color-scheme:light}body{margin:16px;font-family:system-ui,sans-serif;line-height:1.6;overflow-wrap:anywhere}*,*::before,*::after{box-sizing:border-box}img,svg{max-width:100%}pre{overflow:auto}table{border-collapse:collapse}";
  head.prepend(charset, policy, viewport, referrer, defaults);
  return "<!doctype html>\n" + root.outerHTML;
}

export function HtmlArtifact({
  source,
  streaming = false,
  messageStatus,
}: {
  source: string;
  streaming?: boolean;
  messageStatus?: string;
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

  return (
    <TooltipProvider delayDuration={250}>
      <Tabs
        value={selectedView}
        onValueChange={(value) => {
          setView(value);
          setFragmentPreview(value === "preview");
        }}
        className={styles.artifact}
        aria-label="HTML 文档"
        aria-busy={active || undefined}
      >
        <div className={styles.toolbar}>
          <span className={styles.language}>
            {complete ? "HTML" : "HTML · 未完成"}
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
