"use client";

import type { KeyboardEvent } from "react";
import { ArrowUp, Brain, ImagePlus, Loader2, Wand2, X } from "lucide-react";

import { Button, Switch, Textarea } from "@/components/ui";
import {
  MAX_ATTACHMENTS,
  RETENTION_NOTE,
} from "@/components/workbench/conversation-mode-utils";
import type { PendingAttachment } from "@/components/workbench/conversation-types";
import { cn } from "@/lib/utils";

interface ConversationComposerProps {
  attachments: PendingAttachment[];
  canPreview: boolean;
  canSend: boolean;
  composerError: string | null;
  credits: number;
  draft: string;
  isCompiling: boolean;
  isGenerating: boolean;
  isStreaming: boolean;
  modelName: string | null;
  messageCredits: number | null;
  previewOpen: boolean;
  reasoning: boolean;
  onAddFiles: (files: File[]) => void;
  onDraftChange: (value: string) => void;
  onPreview: () => void;
  onReasoningChange: (value: boolean) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: () => void;
}

export function ConversationComposer({
  attachments,
  canPreview,
  canSend,
  composerError,
  credits,
  draft,
  isCompiling,
  isGenerating,
  isStreaming,
  modelName,
  messageCredits,
  previewOpen,
  reasoning,
  onAddFiles,
  onDraftChange,
  onPreview,
  onReasoningChange,
  onRemoveAttachment,
  onSend,
}: ConversationComposerProps): React.ReactElement {
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <>
      {composerError ? (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-1.5 text-[12px] text-danger"
        >
          {composerError}
        </p>
      ) : null}

      <div className="mt-3 shrink-0">
        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {attachments.map((item) => (
              <div
                key={item.id}
                className="group relative h-14 w-14 overflow-hidden rounded-[10px] border border-ink/[0.09] bg-ink/[0.04]"
              >
                <img
                  src={item.dataUrl}
                  alt={item.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(item.id)}
                  aria-label="移除附件"
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-background/80 text-text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                >
                  <X size={11} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-text-muted">
            <Switch
              checked={reasoning}
              onChange={onReasoningChange}
              size="sm"
            />
            <Brain
              size={13}
              strokeWidth={1.5}
              className={reasoning ? "text-brand-soft" : "text-text-faint"}
            />
            <span className={reasoning ? "text-foreground" : undefined}>
              思考模式
            </span>
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={onPreview}
            loading={isCompiling}
            disabled={!canPreview || isStreaming || isGenerating || previewOpen}
            leftIcon={<Wand2 className="h-3.5 w-3.5" />}
          >
            预览出图提示词
          </Button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
          className="group relative flex items-end gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-2.5 pl-3.5 shadow-[var(--shadow-md)] transition-colors duration-150 focus-within:border-ink/60 focus-within:ring-2 focus-within:ring-brand/20"
        >
          <Textarea
            value={draft}
            autoResize
            rows={1}
            maxLength={4000}
            disabled={isStreaming}
            placeholder={isStreaming ? "正在回复…" : "和模型聊聊你想要的画面…"}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onComposerKeyDown}
            className="max-h-40 min-h-[44px] flex-1 border-none bg-transparent px-1 py-2 text-[15px] leading-[1.6] shadow-none hover:border-none focus:border-none focus:shadow-none"
            aria-label="输入对话内容"
          />

          <label
            className={cn(
              "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-border text-text-muted transition-colors duration-150 hover:border-ink/50 hover:bg-ink/[0.05] hover:text-foreground active:scale-[0.95]",
              (isStreaming || attachments.length >= MAX_ATTACHMENTS) &&
                "cursor-not-allowed opacity-40",
            )}
            aria-label="添加图片"
          >
            <ImagePlus size={15} strokeWidth={1.5} />
            <input
              type="file"
              className="sr-only"
              accept="image/*"
              multiple
              disabled={isStreaming || attachments.length >= MAX_ATTACHMENTS}
              onChange={(event) => {
                onAddFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </label>

          <button
            type="submit"
            disabled={!canSend}
            aria-label="发送"
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150",
              !canSend
                ? "bg-ink/[0.05] text-text-faint"
                : "bg-ink text-background hover:bg-brand hover:text-on-brand active:translate-y-0.5",
            )}
          >
            {isStreaming ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <ArrowUp size={20} strokeWidth={2} />
            )}
          </button>
        </form>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[11px] text-text-faint">
          <span>{RETENTION_NOTE}</span>
          <span>
            {modelName ?? "无模型"} · 本次 {messageCredits ?? "--"} 点 · 余额{" "}
            {credits} 点 · Enter 发送 / Shift+Enter 换行
          </span>
        </div>
      </div>
    </>
  );
}
