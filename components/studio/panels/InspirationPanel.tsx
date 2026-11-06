"use client";

import { Button } from "@/components/ui";

import { Lightbulb, Shuffle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { SUGGESTIONS } from "../GenerationWall";

interface InspirationPanelProps {
  /** 点击灵感词：填入提示词草稿（命令坞/编辑器共享）。 */
  onPick: (text: string) => void;
}

/** 提示词灵感面板：一键填入灵感词到提示词草稿。 */
export function InspirationPanel({ onPick }: InspirationPanelProps) {
  const [pool, setPool] = useState<string[]>(SUGGESTIONS);
  const [daily, setDaily] = useState<{
    id: string;
    title: string;
    prompt: string;
    keywords: string[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/inspiration/daily", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.ok && payload.data?.prompt) {
          const prompt = payload.data.prompt;
          setDaily({
            id: prompt.id,
            title: prompt.title,
            prompt: prompt.prompt,
            keywords: prompt.keywords ?? [],
          });
          setPool((current) => [
            prompt.prompt,
            ...prompt.keywords.map(
              (item: string) => `${prompt.title}，围绕「${item}」展开设计探索`,
            ),
            ...current,
          ]);
        }
      })
      .catch(() => undefined);
  }, []);

  const shuffle = () => {
    setPool((current) => [...current].sort(() => Math.random() - 0.5));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-[11px] text-text-muted">点击填入提示词</span>
        <Button
          variant="ghost"
          type="button"
          onClick={shuffle}
          aria-label="换一批"
          title="换一批"
          className="flex h-6 w-6 items-center justify-center rounded p-0 text-text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Shuffle size={12} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {daily ? (
          <div className="mb-2 rounded-md border border-brand/40 bg-brand/5 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
              每日命题
            </p>
            <p className="mt-1 text-xs font-medium">{daily.title}</p>
            <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-text-muted">
              {daily.prompt}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => onPick(daily.prompt)}
              >
                带入工作台
              </Button>
              <Link
                href="/app/inspiration/daily"
                className="tool-button h-7 px-2 text-[11px] text-text-muted"
              >
                查看讨论
              </Link>
            </div>
          </div>
        ) : null}
        {pool.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Lightbulb size={18} className="text-text-faint" />
            <p className="text-xs text-text-muted">暂时没有灵感词</p>
          </div>
        ) : (
          pool.map((text) => (
            <Button
              variant="ghost"
              key={text}
              type="button"
              onClick={() => onPick(text)}
              className="mb-1 flex w-full items-start gap-2 rounded-md border border-border px-2.5 py-2 text-left text-xs leading-4 text-text-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              <Lightbulb
                size={12}
                className="mt-0.5 shrink-0 text-text-faint"
              />
              {text}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
