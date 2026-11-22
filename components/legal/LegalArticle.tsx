"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui";

interface LegalArticleProps {
  title: string;
  version: string;
  updatedAt: string;
  markdown: string;
  /** 没有浏览记录时的返回目标。 */
  backHref?: string;
}

/**
 * 法律条款/隐私政策的统一排版：移动端优先，表格可横向滚动，深浅色跟随主题。
 * 内容来自 lib/legal/*-content.ts，是静态 Markdown，因此整页可以 SSG。
 */
/** 页面头部已显示标题和版本，去掉 Markdown 开头的 H1 与紧随其后的版本引用块，避免重复。 */
function stripLeadingHeader(markdown: string): string {
  const lines = markdown.replace(/^\s+/, "").split("\n");
  let index = 0;
  if (lines[index]?.startsWith("# ")) index += 1;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  if (lines[index]?.startsWith(">")) {
    while (index < lines.length && lines[index].startsWith(">")) index += 1;
  }
  return lines.slice(index).join("\n").replace(/^\s+/, "");
}

export function LegalArticle({
  title,
  version,
  updatedAt,
  markdown,
  backHref = "/",
}: LegalArticleProps): React.ReactElement {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }

    router.push(backHref);
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[760px] items-center gap-2 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 gap-1 text-text-muted hover:text-foreground"
            onClick={goBack}
          >
            <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.8} />
            返回
          </Button>
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-4 pb-[calc(env(safe-area-inset-bottom)+56px)] pt-8 sm:px-6">
        <p className="eyebrow text-text-faint">Chūgǎo Studio</p>
        <h1 className="mt-3 text-[26px] font-semibold leading-[1.2] tracking-[-0.03em] sm:text-[32px]">
          {title}
        </h1>
        <p className="mt-3 font-mono text-xs text-text-faint">
          版本 {version} · 更新日期 {updatedAt}
        </p>

        <article className="legal-prose mt-8">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, ...props }) => (
                <a
                  href={href}
                  target={href?.startsWith("http") ? "_blank" : undefined}
                  rel={href?.startsWith("http") ? "noreferrer" : undefined}
                  {...props}
                >
                  {children}
                </a>
              ),
            }}
          >
            {stripLeadingHeader(markdown)}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
