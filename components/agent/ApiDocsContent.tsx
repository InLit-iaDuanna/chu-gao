"use client";

import { Check, Copy } from "lucide-react";
import { Children, isValidElement, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";

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
  h1: ({ children }) => <h3 className="app-section-title">{children}</h3>,
  h2: ({ children }) => (
    <h4 className="mt-6 border-t border-border pt-5 text-sm font-semibold first:mt-0 first:border-0 first:pt-0">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="mt-5 text-sm font-semibold">{children}</h5>
  ),
  p: ({ children }) => (
    <p className="mt-2 break-words leading-6 text-text-muted [overflow-wrap:anywhere]">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-2 min-w-0 list-disc space-y-1 pl-5 text-text-muted [overflow-wrap:anywhere]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 min-w-0 list-decimal space-y-1 pl-5 text-text-muted [overflow-wrap:anywhere]">
      {children}
    </ol>
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
    <TableContainer
      className="mt-3 min-w-0 max-w-full rounded-lg"
      role="region"
      aria-label="API 文档表格"
      tabIndex={0}
    >
      <Table className="min-w-[560px]">{children}</Table>
    </TableContainer>
  ),
  thead: ({ children }) => (
    <TableHeader className="bg-surface-2">{children}</TableHeader>
  ),
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => (
    <TableHead className="whitespace-nowrap text-left">{children}</TableHead>
  ),
  td: ({ children }) => (
    <TableCell className="align-top text-text-muted">{children}</TableCell>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded-md bg-surface-2 px-1 py-px font-mono text-xs text-foreground">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <CodeBlock code={textOf(children).replace(/\n$/, "")} />
  ),
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
    <div className="min-w-0 text-sm tracking-normal">
      {parts.map((part, index) => (
        <div key={index} className="min-w-0">
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
    return (
      <Skeleton
        role="status"
        aria-hidden={false}
        aria-label="正在加载模型列表"
        className="mt-3 h-24 rounded-md"
      />
    );
  }
  return (
    <TableContainer
      className="mt-3 min-w-0 max-w-full rounded-lg"
      role="region"
      aria-label="模型与价格"
      tabIndex={0}
    >
      <Table>
        <TableHeader className="bg-surface-2">
          <TableRow>
            {[
              "modelId",
              "名称",
              "1K",
              "2K",
              "4K",
              "size",
              "quality",
              "n 上限",
              "参考图",
              "状态",
            ].map((head) => (
              <TableHead key={head} scope="col" className="whitespace-nowrap">
                {head}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((model) => (
            <TableRow key={model.id}>
              <TableCell className="whitespace-nowrap font-mono text-accent">
                {model.id}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {model.displayName}
              </TableCell>
              {(["1K", "2K", "4K"] as const).map((tier) => (
                <TableCell key={tier} className="font-mono tabular-nums">
                  {formatPrice(model.prices[tier])}
                </TableCell>
              ))}
              <TableCell className="font-mono text-text-muted">
                {model.sizes.join(" / ")}
              </TableCell>
              <TableCell className="font-mono text-text-muted">
                {model.qualities.join(" / ")}
              </TableCell>
              <TableCell className="font-mono text-text-muted">
                {model.maxN}
              </TableCell>
              <TableCell className="text-text-muted">
                {model.maxReferenceImages
                  ? `≤ ${model.maxReferenceImages}`
                  : "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {model.available ? (
                  <span className="text-success">可用</span>
                ) : (
                  <span className="text-text-muted">暂不可用</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
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
    <div className="mt-3 min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-surface-2">
      <div className="flex justify-end border-b border-border px-2 py-1">
        <IconButton
          type="button"
          aria-label="复制代码"
          title={copied ? "已复制" : "复制代码"}
          onClick={copy}
          className={cn("h-9 w-9", copied && "text-success")}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </IconButton>
      </div>
      <pre
        tabIndex={0}
        className="min-w-0 max-w-full overflow-x-auto whitespace-pre px-4 py-3 font-mono text-xs leading-6 text-foreground"
      >
        {code}
      </pre>
    </div>
  );
}
