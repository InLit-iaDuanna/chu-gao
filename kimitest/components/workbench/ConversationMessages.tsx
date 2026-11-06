"use client";

import { useState } from "react";
import { Brain, Download, Loader2, Sparkles, User, Wand2 } from "lucide-react";

import { Button, Textarea } from "@/components/ui";
import {
  ImageLightbox,
  ImageZoomHint,
} from "@/components/workbench/ImageLightbox";
import type {
  ChatMessage,
  GenerationView,
} from "@/components/workbench/conversation-types";
import { cn } from "@/lib/utils";

export function ConversationEmpty({
  modelName,
}: {
  modelName: string | null;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface-2">
        <Sparkles size={20} strokeWidth={1.5} className="text-brand-soft" />
      </div>
      <h3 className="font-serif text-[22px] tracking-[-0.01em] text-foreground">
        开始一段对话
      </h3>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-text-muted">
        像聊天一样描述你的想法，需要时附上参考图。聊到合适时点「预览出图提示词」，
        确认后即可生成图片。
      </p>
      {modelName ? (
        <span className="mt-4 rounded-full border border-ink/[0.08] bg-ink/[0.04] px-3 py-1 font-mono text-[11px] text-text-muted">
          {modelName}
        </span>
      ) : null}
    </div>
  );
}

export function UserBubble({
  message,
}: {
  message: ChatMessage;
}): React.ReactElement {
  return (
    <div className="flex justify-end gap-3">
      <div className="flex max-w-[80%] flex-col items-end gap-2">
        {message.images?.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {message.images.map((src, index) => (
              <img
                key={index}
                src={src}
                alt="附件"
                className="max-h-44 rounded-xl border border-border object-cover"
              />
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className="rounded-[var(--radius-lg)] rounded-br-sm border border-ink bg-ink px-4 py-2.5 text-[14.5px] leading-relaxed text-background">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ) : null}
      </div>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/[0.1] bg-ink/[0.05] text-text-muted">
        <User size={13} strokeWidth={1.5} />
      </div>
    </div>
  );
}

export function AssistantBubble({
  message,
  onSelectOption,
}: {
  message: ChatMessage;
  onSelectOption?: (value: string) => void;
}): React.ReactElement {
  const quickOptions = message.isError
    ? []
    : extractQuickOptions(message.content);

  return (
    <div className="flex justify-start gap-3">
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          message.isError
            ? "border-danger/40 bg-danger/10 text-danger"
            : "border-ink bg-ink text-background",
        )}
      >
        <Sparkles size={13} strokeWidth={1.5} />
      </div>
      <div className="flex min-w-0 max-w-[80%] flex-col gap-2">
        {message.reasoning && message.reasoning.trim() ? (
          <ReasoningPanel text={message.reasoning} />
        ) : null}

        {message.generation ? (
          <GenerationCard generation={message.generation} />
        ) : (
          <div
            className={cn(
              "rounded-2xl rounded-bl-md px-4 py-2.5 text-[14.5px] leading-relaxed shadow-[var(--shadow-sm)]",
              message.isError
                ? "border border-danger/30 bg-danger/[0.06] text-danger"
                : "border border-ink/[0.07] bg-ink/[0.03] text-foreground",
            )}
          >
            {message.content ? (
              <>
                <MarkdownText text={message.content} />
                {quickOptions.length > 0 && onSelectOption ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {quickOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => onSelectOption(option)}
                        className="rounded-[var(--radius-sm)] border border-border bg-surface px-3.5 py-1.5 text-left text-[12.5px] leading-5 text-foreground transition-colors duration-150 hover:border-ink hover:bg-ink hover:text-background"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : message.pending ? (
              <TypingDots />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ReasoningPanel({ text }: { text: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-2/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-text-muted transition-colors hover:text-foreground"
      >
        <Brain size={12} strokeWidth={1.5} />
        <span className="font-medium">思考过程</span>
        <span className="ml-auto font-mono text-[10px] text-text-faint">
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open ? (
        <p className="border-t border-border px-3 py-2 text-[12.5px] leading-relaxed text-text-muted whitespace-pre-wrap break-words">
          {text}
        </p>
      ) : null}
    </div>
  );
}

function MarkdownText({ text }: { text: string }): React.ReactElement {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="space-y-2.5 break-words">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading = block.level === 3 ? "h3" : "h4";
          return (
            <Heading
              key={index}
              className="text-[14px] font-semibold leading-6 text-foreground"
            >
              {renderInlineMarkdown(block.text)}
            </Heading>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote
              key={index}
              className="border-l-2 border-[rgb(var(--brand-primary))]/50 pl-3 text-text-muted"
            >
              {renderInlineMarkdown(block.text)}
            </blockquote>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={index} className="space-y-1 pl-4">
              {block.items.map((item) => (
                <li key={item} className="list-disc">
                  {renderInlineMarkdown(item)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap">
            {renderInlineMarkdown(block.text)}
          </p>
        );
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 3 | 4; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const blocks: MarkdownBlock[] = [];
  const lines = normalized.split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    const value = paragraph.join("\n").trim();
    if (value) {
      blocks.push({ type: "paragraph", text: value });
    }
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: "list", items: listItems });
    }
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1].length >= 3 ? 3 : 4,
        text: heading[2].trim(),
      });
      continue;
    }

    const quote = /^>\s+(.+)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: quote[1].trim() });
      continue;
    }

    const list = /^[-*]\s+(.+)$|^\d+[.)]\s+(.+)$/.exec(line);
    if (list) {
      flushParagraph();
      listItems.push((list[1] ?? list[2]).trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.92em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={index}>{part}</span>;
  });
}

function extractQuickOptions(text: string): string[] {
  if (
    !/(请选择|你可以|可以选择|选一个|哪种|哪个|是否|要不要|需要我|更想要|prefer|choose|option)/i.test(
      text,
    )
  ) {
    return [];
  }

  const options = text
    .split(/\r?\n/)
    .map((line) => {
      const match = /^\s*(?:[-*]|\d+[.)])\s+(?:\*\*)?(.+?)(?:\*\*)?\s*$/.exec(
        line,
      );
      return match?.[1]?.replace(/[:：].*$/, "").trim();
    })
    .filter((value): value is string =>
      Boolean(value && value.length >= 2 && value.length <= 28),
    );

  return Array.from(new Set(options)).slice(0, 5);
}

function GenerationCard({
  generation,
}: {
  generation: GenerationView;
}): React.ReactElement {
  const isBusy =
    generation.status === "PENDING" || generation.status === "RUNNING";
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl rounded-bl-md border border-border bg-surface shadow-[var(--shadow-sm)]">
      <div className="group relative aspect-square w-full max-w-[320px] bg-surface-2">
        {generation.imageUrl ? (
          <button
            type="button"
            className="h-full w-full cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
            aria-label="放大查看图片"
            title="放大查看"
          >
            <img
              src={generation.imageUrl}
              alt={generation.prompt.slice(0, 40)}
              className="img-reveal h-full w-full object-contain"
            />
            <ImageZoomHint />
          </button>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-text-faint">
            <Loader2 size={22} className="animate-spin" />
            <span className="font-mono text-[11px]">
              {generation.status === "PENDING" ? "排队中…" : "生成中…"}
            </span>
          </div>
        )}
        {isBusy && generation.progress > 0 ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-surface-3">
            <div
              className="h-full bg-brand transition-all duration-500"
              style={{ width: `${Math.round(generation.progress)}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className="flex items-start gap-2 px-3 py-2">
        <p className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-relaxed text-text-muted">
          {generation.prompt}
        </p>
        {(generation.downloadUrl ?? generation.imageUrl) ? (
          <a
            href={generation.downloadUrl ?? generation.imageUrl ?? undefined}
            download
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-foreground"
            aria-label="下载图片"
            title="下载图片"
          >
            <Download size={14} strokeWidth={1.6} />
          </a>
        ) : null}
      </div>
      <ImageLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        src={generation.imageUrl}
        downloadUrl={generation.downloadUrl ?? generation.imageUrl}
        alt={generation.prompt.slice(0, 80)}
      />
    </div>
  );
}

export function PreviewPanel({
  prompt,
  modelName,
  isGenerating,
  onChange,
  onConfirm,
  onCancel,
}: {
  prompt: string;
  modelName: string;
  isGenerating: boolean;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="mt-3 rounded-[var(--radius-lg)] border border-brand/45 bg-surface p-4 shadow-[var(--shadow-md)]">
      <div className="mb-2 flex items-center gap-2">
        <Wand2
          size={14}
          strokeWidth={1.5}
          className="text-brand"
        />
        <span className="text-[13px] font-medium text-foreground">
          出图提示词预览
        </span>
        <span className="ml-auto rounded-full border border-ink/[0.08] bg-ink/[0.04] px-2 py-0.5 font-mono text-[10.5px] text-text-muted">
          {modelName}
        </span>
      </div>
      <Textarea
        value={prompt}
        autoResize
        maxLength={4000}
        disabled={isGenerating}
        onChange={(event) => onChange(event.target.value)}
        className="max-h-48 min-h-24 text-[13.5px] leading-relaxed"
        aria-label="出图提示词"
      />
      <p className="mt-1.5 text-[11px] leading-5 text-text-faint">
        可在生成前微调提示词。确认后将按当前模型默认参数出 1 张图。
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isGenerating}
        >
          取消
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onConfirm}
          loading={isGenerating}
          disabled={!prompt.trim()}
          leftIcon={<Sparkles className="h-3.5 w-3.5" />}
        >
          确认生成
        </Button>
      </div>
    </div>
  );
}

function TypingDots(): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="正在输入">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-text-faint motion-safe:animate-bounce"
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </span>
  );
}
