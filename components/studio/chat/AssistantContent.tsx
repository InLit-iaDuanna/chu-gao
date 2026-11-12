"use client";

import { createContext, memo, useContext, useId, useState } from "react";
import Markdown, { type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronUp, ImageIcon } from "lucide-react";
import { IconButton, Tooltip, TooltipProvider } from "@/components/ui";
import { CopyTextButton } from "../CopyTextButton";
import { HtmlArtifact, isEmbeddedRasterImage } from "./HtmlArtifact";
import styles from "./AssistantContent.module.css";

const MessageContext = createContext<{
  streaming: boolean;
  messageStatus?: string;
  onOpenArtifact?: (source: string) => void;
}>({ streaming: false });

type MarkdownNode = {
  type: string;
  value?: string;
  lang?: string | null;
  children?: MarkdownNode[];
};

function preserveSoftBreaks() {
  function visit(parent: MarkdownNode) {
    if (!parent.children) return;
    const children: MarkdownNode[] = [];
    for (const child of parent.children) {
      if (child.type === "text" && child.value?.includes("\n")) {
        const lines = child.value.split("\n");
        lines.forEach((line, index) => {
          if (line) children.push({ ...child, value: line });
          if (index < lines.length - 1) children.push({ type: "break" });
        });
      } else {
        visit(child);
        children.push(child);
      }
    }
    parent.children = children;
  }
  return visit;
}

function unwrapMarkdownFence(this: { parse(source: string): unknown }) {
  return (tree: MarkdownNode) => {
    const child = tree.children?.length === 1 ? tree.children[0] : undefined;
    if (child?.type === "code" && /^(?:markdown|md)$/i.test(child.lang ?? "")) {
      tree.children = (this.parse(child.value ?? "") as MarkdownNode).children;
    }
  };
}

function isolateHtmlBlocks() {
  const flowParents = new Set([
    "root",
    "blockquote",
    "listItem",
    "footnoteDefinition",
  ]);
  function visit(parent: MarkdownNode) {
    if (!parent.children) return;
    const children: MarkdownNode[] = [];
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index];
      if (flowParents.has(parent.type) && child.type === "html") {
        // Adjacent style and markup blocks share one isolated document.
        let source = child.value ?? "";
        while (parent.children[index + 1]?.type === "html") {
          source += "\n\n" + (parent.children[++index].value ?? "");
        }
        children.push({ type: "code", lang: "html", value: source });
      } else {
        visit(child);
        children.push(child);
      }
    }
    parent.children = children;
  }
  return visit;
}

const remarkPlugins = [
  remarkGfm,
  unwrapMarkdownFence,
  isolateHtmlBlocks,
  preserveSoftBreaks,
];

function safeLink(value: string): string | undefined {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value, "https://markdown.invalid");
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function isLocalImage(value: string): boolean {
  if (!value.startsWith("/api/")) return false;
  const url = new URL(value, "https://markdown.invalid");
  return (
    (url.pathname === "/api/upload" && url.searchParams.has("key")) ||
    /^\/api\/generations\/[a-z\d_-]+\/images\/[a-z\d_-]+$/i.test(url.pathname)
  );
}

const safeUrl: UrlTransform = (value, key) =>
  key === "src" && isEmbeddedRasterImage(value) ? value : safeLink(value);

function CodeBlock({ source, language }: { source: string; language: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const id = useId();
  return (
    <div className={styles.codeBlock}>
      <div className={styles.toolbar}>
        <span className={styles.language}>{language || "代码"}</span>
        <div className="ml-auto flex shrink-0 items-center">
          <Tooltip content="复制代码">
            <span className="inline-flex">
              <CopyTextButton text={source} label="复制代码" />
            </span>
          </Tooltip>
          <Tooltip content={collapsed ? "展开代码" : "收起代码"}>
            <IconButton
              aria-label={collapsed ? "展开代码" : "收起代码"}
              aria-controls={id}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((value) => !value)}
              className="h-11 w-11 sm:h-9 sm:w-9"
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </IconButton>
          </Tooltip>
        </div>
      </div>
      <pre
        id={id}
        hidden={collapsed}
        tabIndex={0}
        aria-label={language ? `${language} 代码` : "代码块"}
        className={styles.source}
      >
        <code>{source}</code>
      </pre>
    </div>
  );
}

const CodeFence: NonNullable<Components["pre"]> = ({ node, children }) => {
  const { streaming, messageStatus, onOpenArtifact } =
    useContext(MessageContext);
  const code = node?.children.find(
    (child) => child.type === "element" && child.tagName === "code",
  );
  if (code?.type !== "element")
    return <pre className={styles.source}>{children}</pre>;
  const source = code.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("")
    .replace(/\n$/, "");
  const classes = code.properties.className;
  const language =
    (Array.isArray(classes) ? classes : [])
      .find((name) => typeof name === "string" && name.startsWith("language-"))
      ?.toString()
      .slice(9) ?? "";
  return /^(?:html|htm|xhtml)$/i.test(language) ? (
    <HtmlArtifact
      source={source}
      streaming={streaming}
      messageStatus={messageStatus}
      onOpenInPanel={onOpenArtifact ? () => onOpenArtifact(source) : undefined}
    />
  ) : (
    <CodeBlock source={source} language={language} />
  );
};

const components: Components = {
  pre: CodeFence,
  a: ({ href, children, title }) =>
    href ? (
      <a
        href={href}
        title={title}
        target={href.startsWith("#") ? undefined : "_blank"}
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) => {
    if (typeof src !== "string" || !src) return <span>{alt}</span>;
    if (isLocalImage(src) || isEmbeddedRasterImage(src)) {
      return (
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      );
    }
    // External images are explicit links, never automatic requests from the conversation page.
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        className={styles.imageLink}
      >
        <ImageIcon size={16} aria-hidden />
        {alt || "图片"}
      </a>
    );
  },
  table: ({ children }) => (
    <div
      data-markdown-table
      className={styles.tableScroll}
      role="region"
      aria-label="表格"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
};

export const AssistantContent = memo(function AssistantContent({
  content,
  streaming = false,
  messageStatus,
  onOpenArtifact,
}: {
  content: string;
  streaming?: boolean;
  messageStatus?: string;
  onOpenArtifact?: (source: string) => void;
}) {
  const isDocument =
    /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(
      content,
    );
  return (
    <div className={styles.markdown}>
      {isDocument ? (
        <HtmlArtifact
          source={content}
          streaming={streaming}
          messageStatus={messageStatus}
          onOpenInPanel={
            onOpenArtifact ? () => onOpenArtifact(content) : undefined
          }
        />
      ) : (
        <TooltipProvider delayDuration={250}>
          <MessageContext.Provider
            value={{ streaming, messageStatus, onOpenArtifact }}
          >
            <Markdown
              remarkPlugins={remarkPlugins}
              components={components}
              urlTransform={safeUrl}
              remarkRehypeOptions={{ footnoteLabel: "注释" }}
            >
              {content}
            </Markdown>
          </MessageContext.Provider>
        </TooltipProvider>
      )}
    </div>
  );
});
