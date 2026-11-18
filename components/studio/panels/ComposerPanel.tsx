"use client";

import { Button } from "@/components/ui";

import { Textarea } from "@/components/ui";

import { ArrowUp, Wand2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { Spinner } from "@/components/ui";

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
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface text-sm tracking-normal">
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
        className="min-h-0 w-full min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent p-3 text-sm leading-6 text-foreground outline-none placeholder:text-text-muted"
      />

      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-t border-border p-3">
        <span className="min-w-0 basis-full truncate text-xs text-text-muted sm:flex-1 sm:basis-auto">
          {model ? model.displayName : "模型加载中…"}
          <span className="ml-2 tabular-nums">{prompt.length}/4000</span>
        </span>

        <Button
          variant="secondary"
          type="button"
          onClick={onOptimize}
          disabled={optimizing || prompt.trim().length === 0}
          className="h-11 gap-2 rounded-md px-3 text-sm sm:h-9"
        >
          {optimizing ? <Spinner className="h-4 w-4" /> : <Wand2 size={16} />}
          优化
        </Button>

        <Button
          variant="primary"
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          title={disabledReason ?? "生成"}
          className="h-11 gap-2 rounded-md px-3 text-sm sm:h-9"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <ArrowUp size={16} />}
          生成
        </Button>
      </div>
    </div>
  );
}
