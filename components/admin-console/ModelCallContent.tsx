"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  Code2,
  FileText,
  Image as ImageIcon,
  MessageSquareText,
  Maximize2,
  SquareFunction,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
} from "@/components/ui";
import { CopyTextButton } from "@/components/studio/CopyTextButton";
import markdownStyles from "@/components/studio/chat/AssistantContent.module.css";
import {
  buildHtmlPreviewDocument,
  htmlPreviewSource,
} from "@/lib/html-preview";
import {
  isRecord,
  modelCallFieldLabel,
  modelCallRoleLabel,
  parseModelCallContent,
  prettyModelCallValue,
  type JsonValue,
  type ModelCallSseFrame,
  type ParsedModelCallContent,
} from "@/lib/model-call-presenter";

type ContentSide = "request" | "response";

function HtmlPreview({ source }: { source: string }) {
  const [expanded, setExpanded] = useState(false);
  const document = useMemo(() => {
    try {
      return buildHtmlPreviewDocument(source);
    } catch {
      return null;
    }
  }, [source]);
  if (!document) return <ValueBlock value={source} />;
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border/70">
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-[11px] font-medium text-text-muted">
        <ImageIcon size={13} />
        HTML 预览
        <div className="ml-auto flex items-center gap-1">
          <CopyTextButton text={source} label="复制 HTML" />
          <IconButton
            aria-label="放大 HTML 预览"
            title="放大 HTML 预览"
            onClick={() => setExpanded(true)}
            className="h-8 w-8"
          >
            <Maximize2 size={14} />
          </IconButton>
        </div>
      </div>
      <iframe
        title="HTML 预览"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={document}
        className="block h-[420px] max-h-[65dvh] w-full bg-white"
      />
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[90dvh] max-w-[96vw] flex-col gap-3 p-3">
          <DialogTitle>HTML 预览</DialogTitle>
          <iframe
            title="HTML 放大预览"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={document}
            className="min-h-0 w-full flex-1 rounded-md bg-white"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReadableText({
  text,
  preview = true,
}: {
  text: string;
  preview?: boolean;
}) {
  const source = preview ? htmlPreviewSource(text) : null;
  const remainder = source
    ? text
        .replace(
          /(?:^|\n)[ \t]*```(?:html|xml|svg)[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*```/i,
          "",
        )
        .trim()
    : text;
  return (
    <div className="min-w-0 space-y-3">
      {source ? <HtmlPreview source={source} /> : null}
      {(!source || remainder !== text) && remainder ? (
        <div
          className={`${markdownStyles.markdown} text-foreground [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-[11px]`}
        >
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className={markdownStyles.tableScroll}>
                  <table>{children}</table>
                </div>
              ),
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              img: () => <span className="text-text-muted">[图片参考]</span>,
            }}
          >
            {remainder}
          </Markdown>
        </div>
      ) : null}
    </div>
  );
}

function valueIsPrimitive(value: JsonValue) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function ValueBlock({ value }: { value: JsonValue }) {
  if (valueIsPrimitive(value)) {
    return (
      <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground">
        {prettyModelCallValue(value)}
      </p>
    );
  }
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        {value.map((entry, index) => (
          <div key={index} className="min-w-0 border-l border-border pl-2">
            <ValueBlock value={entry} />
          </div>
        ))}
      </div>
    );
  return (
    <dl className="space-y-2">
      {Object.entries(value as Record<string, JsonValue>).map(
        ([key, entry]) => (
          <div key={key} className="min-w-0">
            <dt className="text-[11px] text-text-faint">
              {modelCallFieldLabel(key)}
            </dt>
            <dd className="mt-0.5 min-w-0">
              <ValueBlock value={entry} />
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

function FieldGrid({ entries }: { entries: Array<[string, JsonValue]> }) {
  if (!entries.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="min-w-0 rounded-md border border-border/70 p-2.5"
        >
          <p className="mb-1 text-[10px] font-medium text-text-faint">
            {modelCallFieldLabel(key)}
            {modelCallFieldLabel(key) !== key ? (
              <span className="ml-1 font-mono font-normal text-text-faint/70">
                {key}
              </span>
            ) : null}
          </p>
          <ValueBlock value={value} />
        </div>
      ))}
    </div>
  );
}

function messageText(value: JsonValue | undefined): JsonValue {
  if (value === undefined) return "";
  if (!Array.isArray(value)) return value;
  const textParts = value
    .filter(isRecord)
    .map((part) => {
      if (typeof part.text === "string") return part.text;
      if (typeof part.input_text === "string") return part.input_text;
      if (typeof part.image_url === "string") return "[图片参考]";
      if (isRecord(part.image_url)) return "[图片参考]";
      return null;
    })
    .filter((part): part is string => Boolean(part));
  return textParts.length ? textParts.join("\n") : value;
}

function MessageCard({ value, index }: { value: JsonValue; index: number }) {
  const record = isRecord(value) ? value : null;
  const role = typeof record?.role === "string" ? record.role : "message";
  const content = messageText(record?.content ?? record?.text ?? value);
  const toolCalls = Array.isArray(record?.tool_calls)
    ? record.tool_calls
    : null;
  return (
    <div className="rounded-md border border-border/70 bg-surface-2/35 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <MessageSquareText size={13} className="text-text-muted" />
          {modelCallRoleLabel(role)}
        </span>
        <span className="font-mono text-[10px] text-text-faint">
          #{index + 1}
        </span>
      </div>
      <div className="mt-2">
        {typeof content === "string" ? (
          <ReadableText
            text={content}
            preview={!["system", "developer"].includes(role)}
          />
        ) : (
          <ValueBlock value={content} />
        )}
      </div>
      {toolCalls ? <ToolCallList value={toolCalls} compact /> : null}
    </div>
  );
}

function MessageList({
  label,
  values,
  historyOnly = false,
}: {
  label: string;
  values: JsonValue[];
  historyOnly?: boolean;
}) {
  const system = values
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value }) =>
        isRecord(value) && ["system", "developer"].includes(String(value.role)),
    );
  const messages = values
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value }) =>
        !isRecord(value) ||
        !["system", "developer"].includes(String(value.role)),
    );
  const lastUser = messages.findLastIndex(
    ({ value }) => isRecord(value) && value.role === "user",
  );
  const firstVisible = historyOnly
    ? messages.length
    : lastUser >= 0
      ? lastUser
      : Math.max(0, messages.length - 1);
  const history = messages.slice(0, firstVisible);
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
        <MessageSquareText size={13} />
        {label}
        <span className="font-mono text-[10px] text-text-faint">
          {values.length} 条
        </span>
      </div>
      <div className="space-y-2">
        {messages.slice(firstVisible).map(({ value, index }) => (
          <MessageCard key={index} value={value} index={index} />
        ))}
        {history.length ? (
          <details className="group border-t border-border/60 pt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-text-muted">
              <ChevronDown size={13} />
              {historyOnly ? "已保存的上下文" : "历史上下文"} · {history.length}{" "}
              条
            </summary>
            <div className="mt-2 space-y-2">
              {history.map(({ value, index }) => (
                <MessageCard key={index} value={value} index={index} />
              ))}
            </div>
          </details>
        ) : null}
        {system.length ? (
          <details className="group border-t border-border/60 pt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-text-muted">
              <ChevronDown size={13} />
              系统指令 · {system.length} 条
            </summary>
            <div className="mt-2 space-y-2">
              {system.map(({ value, index }) => (
                <MessageCard key={index} value={value} index={index} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ToolCallList({
  value,
  compact = false,
}: {
  value: JsonValue[];
  compact?: boolean;
}) {
  return (
    <section className={compact ? "mt-2" : ""}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
        <SquareFunction size={13} />
        工具调用
        <span className="font-mono text-[10px] text-text-faint">
          {value.length} 个
        </span>
      </div>
      <div className="space-y-1.5">
        {value.map((item, index) => {
          const record = isRecord(item) ? item : null;
          const fn = isRecord(record?.function) ? record.function : null;
          const name =
            typeof fn?.name === "string"
              ? fn.name
              : typeof record?.name === "string"
                ? record.name
                : "未命名工具";
          const args = fn?.arguments ?? record?.arguments;
          return (
            <div
              key={index}
              className="rounded-md border border-border/70 bg-surface-2/35 px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                <Code2 size={13} className="text-text-muted" />
                {name}
              </div>
              {args !== undefined ? (
                <div className="mt-1.5 min-w-0">
                  <ValueBlock
                    value={
                      typeof args === "string"
                        ? (() => {
                            const parsed = parseModelCallContent(args);
                            return parsed.kind === "json" ? parsed.value : args;
                          })()
                        : args
                    }
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UsageSummary({ value }: { value: JsonValue }) {
  if (!isRecord(value))
    return typeof value === "string" ? (
      <ReadableText text={value} />
    ) : (
      <ValueBlock value={value} />
    );
  const fields: Array<[string, JsonValue]> = [];
  const candidates: Array<[string, string]> = [
    ["输入 Token", "input_tokens"],
    ["提示 Token", "prompt_tokens"],
    ["输出 Token", "output_tokens"],
    ["补全 Token", "completion_tokens"],
    ["缓存读取", "cache_read_input_tokens"],
    ["缓存创建", "cache_creation_input_tokens"],
    ["总计", "total_tokens"],
  ];
  for (const [label, key] of candidates) {
    if (value[key] !== undefined) fields.push([label, value[key]]);
  }
  return fields.length ? (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {fields.map(([label, item]) => (
        <div key={label} className="rounded-md border border-border/70 p-2">
          <p className="text-[10px] text-text-faint">{label}</p>
          <p className="mt-1 font-mono text-[12px] text-foreground">
            {prettyModelCallValue(item)}
          </p>
        </div>
      ))}
    </div>
  ) : (
    <ValueBlock value={value} />
  );
}

function ChoiceList({ value }: { value: JsonValue[] }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
        <MessageSquareText size={13} />
        模型候选回复
      </div>
      <div className="space-y-2">
        {value.map((choice, index) => {
          const record = isRecord(choice) ? choice : null;
          const message = isRecord(record?.message) ? record.message : null;
          const delta = isRecord(record?.delta) ? record.delta : null;
          const content = message?.content ?? delta?.content ?? record?.text;
          const finish = record?.finish_reason;
          const toolCalls = Array.isArray(
            message?.tool_calls ?? delta?.tool_calls,
          )
            ? ((message?.tool_calls ?? delta?.tool_calls) as JsonValue[])
            : null;
          return (
            <div
              key={index}
              className="rounded-md border border-border/70 p-2.5"
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-foreground">
                  候选 {index + 1}
                </span>
                {typeof finish === "string" ? (
                  <span className="font-mono text-text-faint">
                    结束：{finish}
                  </span>
                ) : null}
              </div>
              {content !== undefined ? (
                <div className="mt-2">
                  {typeof messageText(content) === "string" ? (
                    <ReadableText text={messageText(content) as string} />
                  ) : (
                    <ValueBlock value={messageText(content)} />
                  )}
                </div>
              ) : null}
              {toolCalls ? <ToolCallList value={toolCalls} compact /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function JsonReadableView({
  value,
  side,
}: {
  value: JsonValue;
  side: ContentSide;
}) {
  if (!isRecord(value))
    return typeof value === "string" ? (
      <ReadableText text={value} />
    ) : (
      <ValueBlock value={value} />
    );

  const messages = Array.isArray(value.messages)
    ? value.messages
    : Array.isArray(value.input) &&
        value.input.some((item) => isRecord(item) && item.role)
      ? value.input
      : null;
  const choices = Array.isArray(value.choices) ? value.choices : null;
  const toolCalls = Array.isArray(value.tool_calls) ? value.tool_calls : null;
  const usage = value.usage;
  const error = value.error;
  const output = value.text ?? value.output_text;
  const latestInput = value.latest_user_input;
  const hidden = new Set([
    "messages",
    "input",
    "choices",
    "tool_calls",
    "usage",
    "error",
    "text",
    "output_text",
    "latest_user_input",
    "_log",
  ]);
  const fields = Object.entries(value).filter(
    ([key]) => !hidden.has(key),
  ) as Array<[string, JsonValue]>;

  return (
    <div className="space-y-3">
      {typeof latestInput === "string" ? (
        <section className="border-l-2 border-accent pl-3">
          <p className="mb-1.5 text-[11px] font-medium text-text-muted">
            本轮用户输入 · 来自对话记录
          </p>
          <ReadableText text={latestInput} />
        </section>
      ) : null}
      {messages ? (
        <MessageList
          label={side === "request" ? "发送的消息" : "输入消息"}
          values={messages}
          historyOnly={
            typeof latestInput === "string" ||
            (isRecord(value._log) && value._log.truncated === true)
          }
        />
      ) : null}
      {typeof output === "string" ? (
        <section>
          <p className="mb-1.5 text-[11px] font-medium text-text-muted">
            模型输出
          </p>
          <div className="rounded-md border border-border/70 bg-surface-2/35 p-2.5">
            <ReadableText text={output} />
          </div>
        </section>
      ) : null}
      {choices ? <ChoiceList value={choices} /> : null}
      {toolCalls ? <ToolCallList value={toolCalls} /> : null}
      {usage ? (
        <section>
          <p className="mb-1.5 text-[11px] font-medium text-text-muted">用量</p>
          <UsageSummary value={usage} />
        </section>
      ) : null}
      {error ? (
        <section className="rounded-md border border-danger/25 bg-danger/5 p-2.5">
          <p className="mb-1 text-[11px] font-medium text-danger">上游错误</p>
          <ValueBlock value={error} />
        </section>
      ) : null}
      <FieldGrid entries={fields} />
      {!messages &&
      !output &&
      !choices &&
      !toolCalls &&
      !usage &&
      !error &&
      !fields.length ? (
        <p className="text-[12px] text-text-muted">没有可展开的结构化字段。</p>
      ) : null}
    </div>
  );
}

function sseFrameSummary(frame: ModelCallSseFrame): string {
  if (frame.done) return "流结束";
  if (isRecord(frame.value)) {
    if (typeof frame.value.type === "string") return frame.value.type;
    const choices = Array.isArray(frame.value.choices)
      ? frame.value.choices
      : [];
    const choice = isRecord(choices[0]) ? choices[0] : null;
    const delta = isRecord(choice?.delta) ? choice.delta : null;
    if (typeof delta?.content === "string") return delta.content;
    if (typeof frame.value.content === "string") return frame.value.content;
    return "结构化事件";
  }
  return frame.data || "空事件";
}

function SseReadableView({ frames }: { frames: ModelCallSseFrame[] }) {
  const visibleFrames = frames.slice(-20);
  const eventCounts = new Map<string, number>();
  for (const frame of frames) {
    eventCounts.set(frame.event, (eventCounts.get(frame.event) ?? 0) + 1);
  }
  const text = frames
    .map((frame) => {
      if (!isRecord(frame.value)) return "";
      if (
        frame.value.type === "response.output_text.delta" &&
        typeof frame.value.delta === "string"
      )
        return frame.value.delta;
      const delta = isRecord(frame.value.delta) ? frame.value.delta : null;
      if (typeof delta?.text === "string") return delta.text;
      const choices = Array.isArray(frame.value.choices)
        ? frame.value.choices
        : [];
      const choice = isRecord(choices[0]) ? choices[0] : null;
      const chunk = isRecord(choice?.delta) ? choice.delta : null;
      return typeof chunk?.content === "string" ? chunk.content : "";
    })
    .join("");
  return (
    <div className="space-y-3">
      {text ? <ReadableText text={text} /> : null}
      <details>
        <summary className="cursor-pointer text-xs text-text-muted">
          查看流式过程 · {frames.length} 个事件
        </summary>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
          <span>流式事件 {frames.length} 个</span>
          {[...eventCounts.entries()].slice(0, 6).map(([event, count]) => (
            <span
              key={event}
              className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]"
            >
              {event} × {count}
            </span>
          ))}
        </div>
        <div className="space-y-1.5">
          {visibleFrames.map((frame, index) => (
            <div
              key={`${frame.event}-${index}`}
              className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-2 rounded-md border border-border/70 px-2.5 py-2 text-[11px]"
            >
              <span className="font-mono text-text-faint">{frame.event}</span>
              <span className="whitespace-pre-wrap break-words text-foreground">
                {sseFrameSummary(frame)}
              </span>
            </div>
          ))}
        </div>
        {frames.length > visibleFrames.length ? (
          <p className="text-[10px] text-text-faint">
            仅显示最后 {visibleFrames.length} 个事件，完整内容在下方原始记录中。
          </p>
        ) : null}
      </details>
    </div>
  );
}

function kindLabel(parsed: ParsedModelCallContent) {
  if (parsed.kind === "json") return "已按内容整理";
  if (parsed.kind === "sse") return "流式回复";
  if (parsed.kind === "text") return "文本";
  return "空内容";
}

export function ModelCallContent({
  value,
  empty,
  side,
}: {
  value: string | null | undefined;
  empty: string;
  side: ContentSide;
}) {
  const parsed = useMemo(() => parseModelCallContent(value), [value]);

  if (parsed.kind === "empty") {
    return <p className="text-text-muted">{empty}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          {parsed.kind === "sse" ? <Code2 size={14} /> : <FileText size={14} />}
          <span>{side === "request" ? "发送给上游" : "上游返回"}</span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
            {kindLabel(parsed)}
          </span>
        </div>
        <CopyTextButton text={value ?? ""} label="复制原始内容" showText />
      </div>

      {parsed.kind === "json" && parsed.truncated ? (
        <p
          role="status"
          className="border-l-2 border-border-strong pl-2 text-xs leading-5 text-text-muted"
        >
          这条历史日志只保存了部分内容，以下为可恢复部分；未保存的上下文无法还原。
        </p>
      ) : null}
      {parsed.kind === "json" ? (
        <JsonReadableView value={parsed.value} side={side} />
      ) : parsed.kind === "sse" ? (
        <SseReadableView frames={parsed.frames} />
      ) : (
        <div className="rounded-md border border-border/70 bg-surface-2/35 p-2.5">
          <ReadableText text={parsed.value} />
        </div>
      )}

      <details className="group rounded-md border border-border/70">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-[11px] text-text-muted [&::-webkit-details-marker]:hidden">
          <ChevronDown
            size={13}
            className="transition-transform group-open:rotate-180"
          />
          查看原始内容
          <span className="ml-auto text-[10px] text-text-faint">
            用于排查协议
          </span>
        </summary>
        <pre className="max-h-96 overflow-auto border-t border-border bg-surface px-2.5 py-2.5 font-mono text-[11px] leading-5 text-text-muted">
          {parsed.raw}
        </pre>
      </details>
    </div>
  );
}
