"use client";

import { Button, IconButton } from "@/components/ui";

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
    <div className="flex h-full min-h-0 min-w-0 flex-col text-sm tracking-normal">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1">
        <span className="text-xs text-text-muted">点击填入提示词</span>
        <IconButton
          variant="ghost"
          type="button"
          onClick={shuffle}
          aria-label="换一批"
          title="换一批"
          className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
        >
          <Shuffle size={16} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {daily ? (
          <div className="mb-3 border-b border-border px-1 pb-4 pt-2 [overflow-wrap:anywhere]">
            <p className="text-xs font-medium tracking-normal text-brand">
              每日命题
            </p>
            <p className="mt-2 text-sm font-medium">{daily.title}</p>
            <p className="mt-1 line-clamp-3 text-sm leading-6 text-text-muted">
              {daily.prompt}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-11 rounded-md text-sm sm:h-9"
                onClick={() => onPick(daily.prompt)}
              >
                带入工作台
              </Button>
              <Button
                asChild
                variant="ghost"
                className="h-11 rounded-md px-3 text-sm sm:h-9"
              >
                <Link href="/app/inspiration/daily">查看讨论</Link>
              </Button>
            </div>
          </div>
        ) : null}
        {pool.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Lightbulb size={18} className="text-text-faint" />
            <p className="text-sm text-text-muted">暂时没有灵感词</p>
          </div>
        ) : (
          pool.map((text) => (
            <Button
              variant="ghost"
              key={text}
              type="button"
              onClick={() => onPick(text)}
              className="mb-2 h-auto min-h-11 w-full min-w-0 items-start justify-start gap-2 whitespace-normal rounded-md border border-border px-3 py-3 text-left text-sm font-normal leading-6 text-foreground [overflow-wrap:anywhere] sm:min-h-9"
            >
              <Lightbulb
                size={16}
                className="mt-0.5 shrink-0 text-text-faint"
              />
              <span className="min-w-0">{text}</span>
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
