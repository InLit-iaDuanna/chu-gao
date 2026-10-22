"use client";

import { Copy } from "lucide-react";
import { Children, isValidElement, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MODELS_PLACEHOLDER, type ApiDocsModel } from "@/lib/api-docs-shared";
import { cn } from "@/lib/utils";

const remarkPlugins = [remarkGfm];

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? textOf(child.props.children)
          : "",
    )
    .join("");
}

const components: Components = {
  h1: ({ children }) => (
    <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-8 border-t border-border pt-6 text-base font-semibold first:mt-0 first:border-0 first:pt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-5 text-sm font-semibold">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="mt-2 leading-relaxed text-text-muted">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-text-muted">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-muted">{children}</ol>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto rounded-md border border-border text-xs">
      <table className="w-full">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-foreground/[0.04]">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border">{children}</tbody>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top text-text-muted">{children}</td>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-foreground/[0.06] px-1 py-px font-mono text-[0.85em] text-foreground">
        {children}
      </code>
    ),
  pre: ({ children }) => <CodeBlock code={textOf(children).replace(/\n$/, "")} />,
};

/** Render the API docs Markdown, swapping `{{models}}` for the live table. */
export function ApiDocsContent({
  markdown,
  models,
}: {
  markdown: string;
  models: ApiDocsModel[] | null;
}) {
  const parts = markdown.split(MODELS_PLACEHOLDER);
  return (
    <div className="text-sm">
      {parts.map((part, index) => (
        <div key={index}>
          {part.trim() ? (
            <Markdown remarkPlugins={remarkPlugins} components={components}>
              {part}
            </Markdown>
          ) : null}
          {index < parts.length - 1 ? <ModelTable models={models} /> : null}
        </div>
      ))}
    </div>
  );
}

function formatPrice(value: number | undefined) {
  return value === undefined ? "—" : String(value);
}

function ModelTable({ models }: { models: ApiDocsModel[] | null }) {
  if (!models) {
    return <div className="mt-3 h-24 animate-pulse rounded-md bg-foreground/[0.04]" />;
  }
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border text-xs">
      <table className="w-full">
        <thead className="bg-foreground/[0.04]">
          <tr>
            {["modelId", "名称", "1K", "2K", "4K", "size", "quality", "n 上限", "参考图", "状态"].map(
              (head) => (
                <th key={head} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                  {head}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {models.map((model) => (
            <tr key={model.id} className={cn(!model.available && "opacity-55")}>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-accent">{model.id}</td>
              <td className="whitespace-nowrap px-3 py-2">{model.displayName}</td>
              {(["1K", "2K", "4K"] as const).map((tier) => (
                <td key={tier} className="px-3 py-2 font-mono">
                  {formatPrice(model.prices[tier])}
                </td>
              ))}
              <td className="px-3 py-2 font-mono text-text-muted">{model.sizes.join(" / ")}</td>
              <td className="px-3 py-2 font-mono text-text-muted">{model.qualities.join(" / ")}</td>
              <td className="px-3 py-2 font-mono text-text-muted">{model.maxN}</td>
              <td className="px-3 py-2 text-text-muted">
                {model.maxReferenceImages ? `≤ ${model.maxReferenceImages}` : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {model.available ? (
                  <span className="text-success">可用</span>
                ) : (
                  <span className="text-text-faint">暂不可用</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative mt-3 rounded-md border border-border bg-foreground/[0.03]">
      <pre className="overflow-x-auto px-3 py-3 font-mono text-xs leading-relaxed text-foreground">
        {code}
      </pre>
      <button
        type="button"
        aria-label="复制代码"
        onClick={copy}
        className={cn(
          "absolute right-2 top-2 rounded p-1 text-text-muted hover:bg-foreground/[0.08] hover:text-foreground",
          copied && "text-success",
        )}
      >
        <Copy size={12} />
      </button>
    </div>
  );
}
