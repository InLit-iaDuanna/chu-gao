"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileDown,
  Loader2,
  PanelRightClose,
  RotateCcw,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  useToast,
} from "@/components/ui";
import { buildHtmlPreviewDocument } from "@/lib/html-preview";
import { generatePptSlide, isApiError, pptExportUrl } from "../lib/api";
import type { DeckBlock } from "../lib/chat-interactive-blocks";
import { loadDeck, useDeck } from "../lib/deck-store";
import type { PptGeneration, PptSlide } from "../lib/types";
import {
  DeckModeChoice,
  DeckOutlineList,
  deckProgress,
  deckStatusText,
} from "./DeckCard";
import { HtmlArtifact } from "./HtmlArtifact";
import type { QuickReplyHandler } from "./InteractiveBlocks";
import styles from "./Deck.module.css";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const SLIDE_GAP = 24;

const SLIDE_PATTERN = /<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["']/gi;

export function countHtmlSlides(source: string): number {
  return source.match(SLIDE_PATTERN)?.length ?? 0;
}

/** Whether an HTML reply is a deck written to the slide contract. */
export function isHtmlDeck(source: string): boolean {
  return countHtmlSlides(source) >= 2;
}

function withStyle(document: string, css: string) {
  const style = `<style>${css}</style>`;
  return document.includes("</head>")
    ? document.replace("</head>", `${style}</head>`)
    : style + document;
}

const VIEW_CSS = `html,body{margin:0!important;padding:0!important;background:transparent!important;overflow:hidden!important;min-height:0!important}
.slide{margin:0 0 ${SLIDE_GAP}px 0!important;flex:none!important;box-shadow:0 0 0 1px rgba(0,0,0,.08)}`;

const PRINT_HTML_CSS = `@page{size:${SLIDE_WIDTH}px ${SLIDE_HEIGHT}px;margin:0}
html,body{margin:0!important;padding:0!important;background:#fff!important}
.slide{margin:0!important;box-shadow:none!important;break-after:page;page-break-after:always}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;

/**
 * Print a static document through a hidden frame. The frame may not run
 * scripts (sandbox without allow-scripts, and the preview CSP); it is only
 * same-origin so this page can wait for its images and call print().
 */
function printDocument(document: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = window.document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    frame.onload = () => {
      const view = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!view || !doc) {
        cleanup();
        reject(new Error("print frame unavailable"));
        return;
      }
      const images = Array.from(doc.images);
      const started = Date.now();
      const wait = () => {
        if (
          images.every((image) => image.complete) ||
          Date.now() - started > 20_000
        ) {
          view.addEventListener("afterprint", cleanup, { once: true });
          view.focus();
          view.print();
          resolve();
          setTimeout(() => frame.remove(), 120_000);
          return;
        }
        setTimeout(wait, 200);
      };
      wait();
    };
    frame.srcdoc = document;
    window.document.body.append(frame);
  });
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function imageDeckPrintDocument(deck: PptGeneration) {
  const images = deck.slides
    .filter((slide) => slide.status === "completed" && slide.imageUrl)
    .map((slide) => `<img src="${escapeAttribute(slide.imageUrl!)}" alt="">`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeAttribute(
    deck.title ?? "演示文稿",
  )}</title><style>@page{size:13.333in 7.5in;margin:0}html,body{margin:0;padding:0;background:#fff}img{display:block;width:13.333in;height:7.5in;object-fit:cover;break-after:page;page-break-after:always}</style></head><body>${images}</body></html>`;
}

function DeckHtmlView({ source }: { source: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const count = countHtmlSlides(source);
  const document = useMemo(() => {
    try {
      return withStyle(buildHtmlPreviewDocument(source), VIEW_CSS);
    } catch {
      return null;
    }
  }, [source]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  if (!document)
    return (
      <p role="alert" className={styles.notice}>
        幻灯片预览失败
      </p>
    );
  const scale = width ? width / SLIDE_WIDTH : 0;
  const frameHeight = count * (SLIDE_HEIGHT + SLIDE_GAP);
  return (
    <div
      ref={stageRef}
      className={styles.htmlStage}
      style={{ height: scale ? frameHeight * scale : 0 }}
    >
      {scale ? (
        <iframe
          title="可编辑幻灯片预览"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={document}
          style={{
            width: SLIDE_WIDTH,
            height: frameHeight,
            transform: `scale(${scale})`,
          }}
        />
      ) : null}
    </div>
  );
}

function slideStateText(slide: PptSlide, deck: PptGeneration): string {
  switch (slide.status) {
    case "completed":
      return "";
    case "enhancing":
      return "正在构思画面…";
    case "generating":
      return "正在生成…";
    case "failed":
      return slide.error ? `没有生成成功：${slide.error}` : "没有生成成功";
    default:
      return slide.index > 0 &&
        deck.status === "generating" &&
        deck.slides[0]?.status !== "completed" &&
        deck.slides[0]?.status !== "failed"
        ? "等封面完成后开始，以保持全套风格一致"
        : "排队中";
  }
}

function ImageSlides({ deck }: { deck: PptGeneration }) {
  const { toast } = useToast();
  const [zoom, setZoom] = useState<PptSlide | null>(null);
  const [redoing, setRedoing] = useState<string | null>(null);
  const redo = async (slide: PptSlide) => {
    if (redoing) return;
    setRedoing(slide.id);
    try {
      await generatePptSlide({ pptId: deck.id, slideId: slide.id });
      await loadDeck(deck.id);
    } catch (error) {
      toast({
        title: isApiError(error) ? error.message : "这一页没有重新开始生成",
        variant: "danger",
      });
    } finally {
      setRedoing(null);
    }
  };
  return (
    <>
      <ol className={styles.slides} aria-label="幻灯片">
        {deck.slides.map((slide) => {
          const active = slide.status === "generating" || slide.status === "enhancing";
          const image = slide.status === "completed" ? slide.imageUrl : null;
          const label = String(slide.index + 1).padStart(2, "0");
          return (
            <li key={slide.id}>
              {image ? (
                <button
                  type="button"
                  className={styles.slideFrame}
                  aria-label={`放大第 ${slide.index + 1} 页`}
                  onClick={() => setZoom(slide)}
                >
                  <img
                    src={slide.thumbnailUrl ?? image}
                    alt={slide.title ?? `第 ${slide.index + 1} 页`}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ) : (
                <div
                  className={styles.slideFrame}
                  data-state={active ? "active" : undefined}
                >
                  <div className={styles.placeholder}>
                    <span className={styles.placeholderTitle}>{slide.title}</span>
                    <span
                      className={styles.placeholderState}
                      data-failed={slide.status === "failed" || undefined}
                    >
                      {active ? <Loader2 size={12} className="animate-spin" /> : null}
                      <span className={slide.status === "failed" ? styles.error : undefined}>
                        {slideStateText(slide, deck)}
                      </span>
                    </span>
                  </div>
                </div>
              )}
              <div className={styles.slideMeta}>
                <span className={styles.number}>{label}</span>
                <span className={styles.slideMetaTitle}>{slide.title}</span>
                {slide.status === "completed" || slide.status === "failed" ? (
                  <IconButton
                    variant="ghost"
                    aria-label={`重画第 ${slide.index + 1} 页`}
                    title="重画这一页"
                    disabled={Boolean(redoing)}
                    onClick={() => void redo(slide)}
                    className="h-8 w-8 text-text-muted"
                  >
                    {redoing === slide.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                  </IconButton>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <Dialog open={Boolean(zoom)} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent
          hideClose
          aria-describedby={undefined}
          className="studio-workspace w-[calc(100vw-24px)] max-w-6xl overflow-hidden p-0"
        >
          <div className="flex h-12 items-center gap-2 border-b border-border px-3">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium tracking-normal">
              {zoom ? `${zoom.index + 1}. ${zoom.title ?? ""}` : ""}
            </DialogTitle>
            <IconButton
              aria-label="关闭"
              onClick={() => setZoom(null)}
              className="h-10 w-10 border-transparent bg-transparent"
            >
              <X size={16} />
            </IconButton>
          </div>
          {zoom?.imageUrl ? (
            <img
              src={zoom.imageUrl}
              alt={zoom.title ?? ""}
              className="block max-h-[calc(100dvh-120px)] w-full bg-black object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeckPanel({
  deckId,
  outline,
  html,
  canSend,
  onQuickReply,
  onClose,
  mobile = false,
}: {
  deckId: string;
  outline: DeckBlock | null;
  /** The latest HTML deck the assistant wrote for this outline (code mode). */
  html: { source: string; streaming: boolean } | null;
  canSend: boolean;
  onQuickReply?: QuickReplyHandler;
  onClose: () => void;
  mobile?: boolean;
}) {
  const { toast } = useToast();
  const { deck, error } = useDeck(deckId);
  const [printing, setPrinting] = useState(false);
  const title = deck?.title ?? outline?.title ?? "演示文稿";
  const { done } = deckProgress(deck);
  const htmlDeck = html && !html.streaming && isHtmlDeck(html.source) ? html.source : null;

  const exportPdf = async () => {
    if (printing || !deck) return;
    setPrinting(true);
    try {
      const document =
        deck.mode === "image"
          ? imageDeckPrintDocument(deck)
          : htmlDeck
            ? withStyle(buildHtmlPreviewDocument(htmlDeck), PRINT_HTML_CSS)
            : null;
      if (!document) return;
      await printDocument(document);
    } catch {
      toast({ title: "PDF 导出失败", variant: "danger" });
    } finally {
      setPrinting(false);
    }
  };
  const downloadHtml = () => {
    if (!htmlDeck) return;
    const url = URL.createObjectURL(
      new Blob([buildHtmlPreviewDocument(htmlDeck)], {
        type: "text/html;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title}.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const canPdf =
    deck?.mode === "image" ? done > 0 : deck?.mode === "code" && Boolean(htmlDeck);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <strong>{title}</strong>
          <span>{deck ? deckStatusText(deck) : error ?? "正在读取…"}</span>
        </div>
        {deck?.mode === "image" && done > 0 ? (
          <IconButton
            variant="ghost"
            aria-label="下载全部图片"
            title="下载全部图片（ZIP）"
            onClick={() => window.open(pptExportUrl(deck.id), "_blank")}
            className="h-9 w-9 text-text-muted"
          >
            <Download size={16} />
          </IconButton>
        ) : null}
        {deck?.mode === "code" && htmlDeck ? (
          <IconButton
            variant="ghost"
            aria-label="下载 HTML"
            title="下载 HTML"
            onClick={downloadHtml}
            className="h-9 w-9 text-text-muted"
          >
            <Download size={16} />
          </IconButton>
        ) : null}
        {canPdf ? (
          <IconButton
            variant="ghost"
            aria-label="导出 PDF"
            title="导出 PDF（在打印窗口选择“另存为 PDF”）"
            onClick={() => void exportPdf()}
            disabled={printing}
            className="h-9 w-9 text-text-muted"
          >
            {printing ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
          </IconButton>
        ) : null}
        <IconButton
          variant="ghost"
          aria-label="关闭右侧预览"
          title="关闭"
          onClick={onClose}
          className="h-9 w-9 text-text-muted"
        >
          {mobile ? <X size={17} /> : <PanelRightClose size={17} />}
        </IconButton>
      </div>
      <div className={styles.panelBody}>
        {!deck ? (
          error ? (
            <p role="alert" className={styles.notice}>
              {error}
            </p>
          ) : (
            <p className={styles.notice}>
              <Loader2 size={14} className="animate-spin" /> 正在读取演示文稿…
            </p>
          )
        ) : !deck.mode ? (
          outline ? (
            <section className={styles.card} aria-label="演示文稿大纲">
              <DeckOutlineList outline={outline} limit={null} />
              <DeckModeChoice
                outline={outline}
                deck={deck}
                canSend={canSend}
                onQuickReply={onQuickReply}
              />
            </section>
          ) : null
        ) : deck.mode === "image" ? (
          <ImageSlides deck={deck} />
        ) : htmlDeck ? (
          <DeckHtmlView source={htmlDeck} />
        ) : html && !html.streaming ? (
          // The reply is HTML but not written to the slide contract.
          <div className="h-[70vh]">
            <HtmlArtifact source={html.source} messageStatus="completed" variant="panel" />
          </div>
        ) : (
          <>
            <p className={styles.notice} role="status">
              {html?.streaming || !canSend ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> 正在排版幻灯片，完成后显示在这里…
                </>
              ) : (
                "还没有排好的幻灯片。可以在对话里说“排版成可编辑幻灯片”。"
              )}
            </p>
            {outline ? (
              <section className={styles.card} aria-label="演示文稿大纲">
                <DeckOutlineList outline={outline} limit={null} />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
