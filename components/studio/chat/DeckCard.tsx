"use client";

import { useState } from "react";
import {
  ArrowRight,
  ImageIcon,
  Loader2,
  PanelRightOpen,
  Presentation,
  Type,
} from "lucide-react";
import { isApiError, renderDeck } from "../lib/api";
import type { DeckBlock } from "../lib/chat-interactive-blocks";
import { loadDeck, patchDeck, useDeck } from "../lib/deck-store";
import type { PptGeneration } from "../lib/types";
import type { QuickReplyHandler } from "./InteractiveBlocks";
import styles from "./Deck.module.css";

export type DeckMode = "image" | "code";

/** The message the code option sends; the agent contract answers it with an HTML deck. */
export function codeDeckRequest(title: string) {
  return `把《${title}》这份大纲排版成可编辑幻灯片`;
}

function formatCredits(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function deckProgress(deck: PptGeneration | null) {
  const total = deck?.slides.length ?? 0;
  const done = deck?.slides.filter((slide) => slide.status === "completed").length ?? 0;
  const failed = deck?.slides.filter((slide) => slide.status === "failed").length ?? 0;
  return { total, done, failed };
}

export function deckStatusText(deck: PptGeneration | null): string {
  if (!deck?.mode) return "大纲待确认";
  if (deck.mode === "code") return "可编辑幻灯片";
  const { total, done, failed } = deckProgress(deck);
  if (deck.status === "generating")
    return `整页设计图 · 正在生成 ${done}/${total}`;
  if (failed && done) return `整页设计图 · 完成 ${done} 页，${failed} 页未成功`;
  if (!done) return "整页设计图 · 没有生成成功";
  return `整页设计图 · ${total} 页已完成`;
}

export function DeckOutlineList({
  outline,
  limit,
}: {
  outline: DeckBlock;
  /** Show this many rows first; null shows all. */
  limit: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows =
    limit !== null && !expanded ? outline.slides.slice(0, limit) : outline.slides;
  const hidden = outline.slides.length - rows.length;
  return (
    <>
      {rows.length ? (
      <ol className={styles.outline} aria-label="逐页大纲">
        {rows.map((slide, index) => (
          <li key={index} className={styles.outlineItem}>
            <span className={styles.number} aria-hidden>
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p className={styles.slideTitle}>{slide.title}</p>
              {slide.points.length ? (
                <p className={styles.slidePoints}>{slide.points.join(" · ")}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      ) : null}
      {hidden > 0 ? (
        <button
          type="button"
          className={styles.more}
          onClick={() => setExpanded(true)}
        >
          {rows.length ? `展开其余 ${hidden} 页` : `查看大纲（${hidden} 页）`}
        </button>
      ) : null}
    </>
  );
}

/** The two ways to make a confirmed outline. Shared by the card and the panel. */
export function DeckModeChoice({
  outline,
  deck,
  canSend,
  onQuickReply,
  onOpenDeck,
}: {
  outline: DeckBlock;
  deck: PptGeneration | null;
  /** The conversation can take a new message right now (no turn in flight). */
  canSend: boolean;
  onQuickReply?: QuickReplyHandler;
  onOpenDeck?: (id: string) => void;
}) {
  const [busy, setBusy] = useState<DeckMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slideCredits = deck?.slideCredits ?? null;
  const total = outline.slides.length;

  const choose = async (mode: DeckMode) => {
    if (busy) return;
    setBusy(mode);
    setError(null);
    try {
      await renderDeck(outline.id, mode);
      patchDeck(outline.id, {
        mode,
        status: mode === "image" ? "generating" : "completed",
      });
      if (mode === "code") {
        const sent = await Promise.resolve(
          onQuickReply?.(codeDeckRequest(outline.title)),
        );
        if (sent === false)
          setError("排版请求没有发出去，可以在输入框里说“排版成可编辑幻灯片”");
      }
      onOpenDeck?.(outline.id);
      void loadDeck(outline.id);
    } catch (chooseError) {
      setError(
        isApiError(chooseError) ? chooseError.message : "没有开始制作，请稍后再试",
      );
    } finally {
      setBusy(null);
    }
  };

  const codeReady = canSend && Boolean(onQuickReply);
  return (
    <div className={styles.choice} role="group" aria-label="选择制作方式">
      <p className={styles.choiceQuestion}>大纲没问题的话，选一种做法</p>
      <button
        type="button"
        className={styles.mode}
        disabled={Boolean(busy) || !deck}
        onClick={() => void choose("image")}
      >
        <span className={styles.modeIcon} aria-hidden>
          {busy === "image" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <ImageIcon size={15} strokeWidth={1.75} />
          )}
        </span>
        <span className={styles.modeText}>
          <span className={styles.modeLabel}>整页设计图</span>
          <span className={styles.modeDescription}>
            每页画成一张完整的设计稿，画面感最强；文字画在图里，之后不能逐字修改。
          </span>
          <span className={styles.modeMeta}>
            {slideCredits !== null
              ? `约 ${formatCredits(slideCredits * total)} 积分 · ${total} 页`
              : `${total} 页`}
          </span>
        </span>
        <ArrowRight className={styles.arrow} size={15} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className={styles.mode}
        disabled={Boolean(busy) || !deck || !codeReady}
        onClick={() => void choose("code")}
      >
        <span className={styles.modeIcon} aria-hidden>
          {busy === "code" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Type size={15} strokeWidth={1.75} />
          )}
        </span>
        <span className={styles.modeText}>
          <span className={styles.modeLabel}>可编辑幻灯片</span>
          <span className={styles.modeDescription}>
            按大纲排出版式，文字清晰准确、随时能改，可以导出 PDF。
          </span>
          <span className={styles.modeMeta}>
            {codeReady ? "按对话用量计费，通常一两分钟" : "等当前回复结束后可选"}
          </span>
        </span>
        <ArrowRight className={styles.arrow} size={15} strokeWidth={1.75} aria-hidden />
      </button>
      <div className={styles.footer}>
        {error ? (
          <span role="alert" className={styles.error}>
            {error}
          </span>
        ) : (
          <span>要改大纲，直接在输入框里告诉我</span>
        )}
      </div>
    </div>
  );
}

export function DeckCard({
  outline,
  interactive,
  onQuickReply,
  onOpenDeck,
}: {
  outline: DeckBlock;
  /** Latest reply with no turn in flight: the code option can send its message. */
  interactive: boolean;
  onQuickReply?: QuickReplyHandler;
  onOpenDeck?: (id: string) => void;
}) {
  const { deck, error } = useDeck(outline.id);
  const started = Boolean(deck?.mode);
  const { total, done } = deckProgress(deck);
  return (
    <section aria-label="演示文稿大纲" className={styles.card}>
      <div className={styles.head}>
        <div className="min-w-0">
          <p className={styles.eyebrow}>
            <Presentation size={13} strokeWidth={1.75} aria-hidden />
            演示文稿 · {outline.slides.length} 页
          </p>
          <p className={styles.title}>{outline.title}</p>
          {outline.style ? <p className={styles.style}>{outline.style}</p> : null}
        </div>
        {onOpenDeck ? (
          <button
            type="button"
            className={styles.openButton}
            onClick={() => onOpenDeck(outline.id)}
          >
            <PanelRightOpen size={14} strokeWidth={1.75} aria-hidden />
            {started ? "查看" : "侧栏打开"}
          </button>
        ) : null}
      </div>
      <DeckOutlineList outline={outline} limit={started ? 0 : 6} />
      {started ? (
        <div className={styles.status} role="status">
          <span>{deckStatusText(deck)}</span>
          {deck?.mode === "image" && deck.status === "generating" ? (
            <span className={styles.progress} aria-hidden>
              <span
                className={styles.progressBar}
                style={{ width: `${total ? (done / total) * 100 : 0}%` }}
              />
            </span>
          ) : null}
        </div>
      ) : error && !deck ? (
        <div className={styles.footer}>
          <span>{error}</span>
        </div>
      ) : (
        <DeckModeChoice
          outline={outline}
          deck={deck}
          canSend={interactive}
          onQuickReply={onQuickReply}
          onOpenDeck={onOpenDeck}
        />
      )}
    </section>
  );
}
