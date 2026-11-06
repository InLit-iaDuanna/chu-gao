"use client";

import { Button } from "@/components/ui";

import { Textarea } from "@/components/ui";

import { ArrowUp, Wand2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

import type { ModelInfo } from "../lib/types";

interface ComposerPanelProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  model: ModelInfo | null;
  busy: boolean;
  optimizing: boolean;
  onOptimize: () => void;
  onSubmit: () => void;
  disabledReason: string | null;
}

/** 提示词编辑面板：可停靠到任意边的大文本编辑区，与底部命令坞共享同一份草稿。 */
export function ComposerPanel({
  prompt,
  onPromptChange,
  model,
  busy,
  optimizing,
  onOptimize,
  onSubmit,
  disabledReason,
}: ComposerPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submitDisabled =
    busy || Boolean(disabledReason) || !model || prompt.trim().length === 0;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <Textarea
        ref={textareaRef}
        value={prompt}
        maxLength={4000}
        placeholder="在这里编写提示词，Enter 发送 · Shift+Enter 换行"
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (!submitDisabled) onSubmit();
          }
        }}
        aria-label="提示词编辑"
        className="min-h-0 w-full flex-1 resize-none bg-transparent p-3 text-[13px] leading-6 text-foreground outline-none placeholder:text-text-faint"
      />

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border px-2.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-faint">
          {model ? model.displayName : "模型加载中…"}
          <span className="ml-2 tabular-nums">{prompt.length}/4000</span>
        </span>

        <Button
          variant="ghost"
          type="button"
          onClick={onOptimize}
          disabled={optimizing || prompt.trim().length === 0}
          className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
        >
          {optimizing ? <Spinner className="h-3 w-3" /> : <Wand2 size={12} />}
          优化
        </Button>

        <Button
          variant="ghost"
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          title={disabledReason ?? "生成"}
          className={cn(
            "flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors",
            submitDisabled
              ? "bg-surface-2 text-text-faint"
              : "sweep pressable bg-brand text-on-accent hover:bg-brand/88",
          )}
        >
          {busy ? <Spinner className="h-3 w-3" /> : <ArrowUp size={12} />}
          生成
        </Button>
      </div>
    </div>
  );
}
