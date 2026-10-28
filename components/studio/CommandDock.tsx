"use client";

import {
  ArrowUp,
  Sparkles,
  Check,
  ChevronDown,
  ImageIcon,
  Maximize2,
  MessageSquare,
  Plus,
  Ratio,
  RefreshCw,
  SlidersHorizontal,
  Square,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuItem,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  ChatModelOption,
  ReasoningEffort,
} from "@/lib/chat-model-options";
import type { ModelInfo } from "./lib/types";
import { ReferenceDropZone, ReferenceThumbnails } from "./ReferenceDropZone";
import { CopyTextButton } from "./CopyTextButton";
import { QualitySlider, qualityLabel } from "./QualitySlider";
import { ChatModelControls } from "./ChatModelControls";
import { REFERENCE_ACCEPT } from "./lib/reference-input";

export interface ReferenceItem {
  kind: "upload" | "source";
  key: string;
  previewUrl: string;
}

export interface DockParams {
  size?: string;
  quality?: string;
  n: number;
  negativePrompt?: string;
  seed?: number;
  outputFormat?: string;
  referenceImages: ReferenceItem[];
}

interface CommandDockProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  agentQuestion?: string | null;
  onClearAgentQuestion?: () => void;
  models: ModelInfo[];
  model: ModelInfo | null;
  onSelectModel: (id: string) => void;
  params: DockParams;
  onParamsChange: (patch: Partial<DockParams>) => void;
  busy: boolean;
  optimizing: boolean;
  onOptimize: () => void;
  onUploadFile: (file: File) => void;
  onRemoveReference: (key: string) => void;
  /** 发送对话（chat 模式）或 agent 提交 */
  onSubmit: () => void;
  /** 专用生图按钮：仅在 image 模式下由外部点击时调用，不传则沿用 onSubmit */
  onGenerateImage?: () => void;
  disabledReason: string | null;
  uploading?: number;
  onAddReference?: (reference: ReferenceItem) => void;
  focusVersion?: number;
  mode?: "image" | "chat" | "agent";
  onModeChange?: (mode: "image" | "chat" | "agent") => void;
  onStop?: () => void;
  chatModels?: ChatModelOption[];
  chatModel?: ChatModelOption | null;
  chatReasoningEffort?: ReasoningEffort;
  onSelectChatModel?: (id: string) => void;
  onChatReasoningEffortChange?: (effort: ReasoningEffort) => void;
  chatUnavailableReason?: string | null;
  onRetryChatModels?: () => void;
  creativeEnabled?: boolean;
  centered?: boolean;
  chatTools?: ReactNode;
}

export function sizeLabel(size: string): string {
  if (size === "auto") return "自动";
  const [w, h] = size.split("x").map(Number);
  if (w === h) return size + " · 1:1";
  if (w && h) {
    const ratio = w / h;
    for (const [width, height] of [
      [3, 2],
      [2, 3],
      [16, 9],
      [9, 16],
      [4, 3],
      [3, 4],
    ]) {
      if (Math.abs(ratio - width / height) < 0.01)
        return size + " · " + width + ":" + height;
    }
  }
  return size;
}

export function CommandDock({
  prompt,
  onPromptChange,
  agentQuestion,
  onClearAgentQuestion,
  models,
  model,
  onSelectModel,
  params,
  onParamsChange,
  busy,
  optimizing,
  onOptimize,
  onUploadFile,
  onRemoveReference,
  onSubmit,
  onGenerateImage,
  disabledReason,
  uploading = 0,
  onAddReference = () => undefined,
  focusVersion = 0,
  mode,
  onModeChange,
  onStop,
  chatModels = [],
  chatModel = null,
  chatReasoningEffort,
  onSelectChatModel = () => undefined,
  onChatReasoningEffortChange = () => undefined,
  chatUnavailableReason,
  onRetryChatModels,
  creativeEnabled = false,
  centered = false,
  chatTools,
}: CommandDockProps) {
  const [expanded, setExpanded] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isChat = mode === "chat";
  const isAgent = mode === "agent";
  const maxN = isAgent ? 1 : Math.min(model?.capabilities.maxN ?? 1, 4);
  const sizes = model?.capabilities.sizes ?? [];
  const qualities = model?.capabilities.qualities ?? [];
  const outputFormats = model?.capabilities.outputFormats ?? [];
  const supportsReference = isChat
    ? (chatModel?.supportsVision ?? false)
    : (model?.capabilities.supportsReferenceImage ?? false);
  const maxReferences = isChat
    ? (chatModel?.maxReferenceImages ?? 0)
    : (model?.capabilities.maxReferenceImages ?? 0);
  const referencesFull = params.referenceImages.length >= maxReferences;
  const chatStatus =
    chatUnavailableReason ??
    (!chatModel ? "正在加载聊天模型，暂不能发送" : null);
  const submitDisabled =
    busy ||
    uploading > 0 ||
    Boolean(disabledReason) ||
    (isChat ? !chatModel || Boolean(chatStatus) : !model) ||
    !prompt.trim();
  /* image 模式专用生图按钮：需要模型可用且有提示词，不受 chat 模型限制 */
  const generateDisabled =
    busy || uploading > 0 || Boolean(disabledReason) || !model || !prompt.trim();
  const toolClass =
    "h-11 w-11 shrink-0 rounded-md border-transparent bg-transparent p-0 text-text-muted hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 sm:h-10 sm:w-10 aria-disabled:border-transparent aria-disabled:bg-transparent";
  const selectedSize = params.size ?? model?.defaults.size ?? "auto";
  const selectedQuality =
    params.quality ?? model?.defaults.quality ?? qualities[0] ?? "auto";

  useEffect(() => {
    if (!focusVersion) return;
    const timer = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [focusVersion]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [prompt, mode, centered]);

  return (
    <div className="space-y-3">
      {mode && onModeChange ? (
        <div
          className={cn(
            "flex min-h-10 items-center",
            centered && "justify-center pb-1",
          )}
        >
          <Segmented
            value={mode}
            onChange={onModeChange}
            aria-label="创作模式"
            className="studio-mode-switch inline-flex max-w-full gap-0.5 rounded-lg border border-border/70 bg-surface-2 p-1 [&_button]:h-10 [&_button]:min-w-0 [&_button]:px-3 [&_button]:text-xs sm:[&_button]:h-8 sm:[&_button]:px-4 sm:[&_button]:text-[13px] [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0"
            options={[
              {
                value: "image",
                ariaLabel: "生成图片",
                disabled: busy || uploading > 0,
                label: (
                  <span className="inline-flex items-center gap-1.5 sm:gap-2">
                    <ImageIcon size={16} />
                    生成图片
                  </span>
                ),
              },
              {
                value: "chat",
                ariaLabel: "讨论想法",
                disabled: busy || uploading > 0,
                label: (
                  <span className="inline-flex items-center gap-1.5 sm:gap-2">
                    <MessageSquare size={16} />
                    讨论想法
                  </span>
                ),
              },
              ...(creativeEnabled
                ? [
                    {
                      value: "agent" as const,
                      ariaLabel: "创作 Agent",
                      disabled: busy || uploading > 0,
                      label: (
                        <span className="inline-flex items-center gap-1.5 sm:gap-2">
                          <Sparkles size={16} />
                          创作 Agent
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}

      {isChat && chatStatus ? (
        <div
          role={onRetryChatModels ? "alert" : "status"}
          className="flex min-w-0 items-center justify-between gap-3 px-1 text-xs text-text-muted"
        >
          <span className="min-w-0 break-words">{chatStatus}</span>
          {onRetryChatModels ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetryChatModels}
              disabled={busy || uploading > 0}
              aria-label="重新加载聊天模型"
              className="shrink-0 gap-1.5"
            >
              <RefreshCw size={14} />
              重试
            </Button>
          ) : null}
        </div>
      ) : null}

      <ReferenceDropZone
        onFile={onUploadFile}
        onReference={onAddReference}
        disabled={busy || !supportsReference || referencesFull}
        className="dock-shell studio-composer rounded-lg"
      >
        <ReferenceThumbnails
          references={params.referenceImages}
          uploading={uploading}
          onRemove={onRemoveReference}
        />
        <div className="space-y-4 p-3.5 sm:p-5 sm:pb-3">
          {isAgent && agentQuestion ? (
            <div className="flex min-w-0 items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs leading-5 text-text-muted">
              <span className="shrink-0 font-medium text-foreground">回答</span>
              <span className="min-w-0 flex-1 break-words">
                {agentQuestion}
              </span>
              <IconButton
                type="button"
                variant="ghost"
                aria-label="取消回答问题"
                title="取消回答问题"
                onClick={onClearAgentQuestion}
                className="h-6 w-6 shrink-0 text-text-muted"
              >
                <X size={14} />
              </IconButton>
            </div>
          ) : null}
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={prompt}
              rows={isChat && !centered ? 1 : 2}
              maxLength={4000}
              disabled={busy}
              placeholder={
                isAgent
                  ? agentQuestion
                    ? "回答这个问题…"
                    : "告诉我你的创作目标或需要调整的地方…"
                  : isChat
                    ? "聊聊你的想法…"
                    : "描述画面、风格和你想保留的细节…"
              }
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
              className={cn(
                "block max-h-[180px] w-full min-w-0 resize-none rounded-none border-0 bg-transparent p-0 text-base leading-7 shadow-none outline-none placeholder:text-text-faint hover:border-transparent hover:bg-transparent focus:border-transparent focus:shadow-none focus:ring-0 focus-visible:ring-0 disabled:bg-transparent sm:text-[15px]",
                isChat && !centered ? "min-h-10" : "min-h-16",
                isChat && "pr-10 sm:pr-0",
              )}
              aria-label={isAgent ? "创作需求" : isChat ? "对话输入" : "提示词"}
            />
            {isChat ? (
              <IconButton
                type="button"
                variant="ghost"
                aria-label="展开消息编辑"
                title="展开编辑"
                disabled={busy}
                onClick={() => setExpanded(true)}
                className="absolute right-0 top-0 h-9 w-9 border-transparent bg-transparent text-text-faint hover:bg-surface-2 hover:text-foreground sm:hidden"
              >
                <Maximize2 size={16} />
              </IconButton>
            ) : null}
          </div>

          <div
            className={cn(
              "items-center gap-x-1 gap-y-2",
              isChat
                ? "grid grid-cols-[auto_minmax(0,1fr)_auto] sm:flex"
                : "grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_auto_minmax(0,1fr)_auto]",
            )}
            aria-label="输入工具栏"
          >
            <div
              className={cn(
                "col-start-1 flex shrink-0 items-center gap-0.5",
                isChat ? "row-start-1" : "row-start-2 sm:row-start-1",
                isChat && !supportsReference && "hidden",
              )}
            >
              {supportsReference ? (
                <IconButton
                  asChild
                  variant="ghost"
                  size="lg"
                  aria-label="上传参考图"
                  aria-disabled={referencesFull || busy}
                  title={"添加参考图（最多 " + maxReferences + " 张）"}
                  className={cn(
                    toolClass,
                    referencesFull || busy
                      ? "cursor-not-allowed"
                      : "cursor-pointer",
                  )}
                >
                  <label className="relative flex h-full w-full items-center justify-center focus-within:ring-2 focus-within:ring-brand/40">
                    <Plus size={20} aria-hidden />
                    <Input
                      type="file"
                      className="sr-only h-px w-px border-0 p-0"
                      accept={REFERENCE_ACCEPT}
                      multiple
                      disabled={busy || referencesFull}
                      aria-label="选择参考图文件"
                      onChange={(event) => {
                        Array.from(event.target.files ?? []).forEach(
                          onUploadFile,
                        );
                        event.target.value = "";
                      }}
                    />
                  </label>
                </IconButton>
              ) : null}
              {!isChat ? (
                <Popover open={paramsOpen} onOpenChange={setParamsOpen}>
                  <PopoverTrigger asChild>
                    <IconButton
                      variant="ghost"
                      size="lg"
                      type="button"
                      aria-label="生成参数"
                      title="生成参数与工具"
                      aria-pressed={paramsOpen}
                      disabled={busy}
                      className={cn(
                        toolClass,
                        paramsOpen && "bg-surface-2 text-foreground",
                      )}
                    >
                      <SlidersHorizontal size={19} />
                    </IconButton>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    collisionPadding={12}
                    aria-label="生成参数"
                    className="studio-workspace max-h-[min(65dvh,var(--radix-popover-content-available-height))] w-[min(320px,calc(100vw-24px))] overflow-y-auto p-4"
                  >
                    <div className="space-y-5">
                      <p className="text-sm font-semibold">生成参数</p>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-text-muted">
                          图片尺寸
                        </p>
                        <Select
                          aria-label="图片尺寸"
                          value={selectedSize}
                          onValueChange={(size) => onParamsChange({ size })}
                          options={sizes.map((size) => ({
                            value: size,
                            label: sizeLabel(size),
                          }))}
                          controlSize="lg"
                        />
                      </div>
                      {qualities.length > 1 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-medium text-text-muted">
                              生成质量
                            </p>
                            <span className="text-xs font-medium text-foreground">
                              {qualityLabel(selectedQuality)}
                            </span>
                          </div>
                          <QualitySlider
                            options={qualities}
                            value={selectedQuality}
                            onChange={(quality) => onParamsChange({ quality })}
                          />
                        </div>
                      ) : null}
                      {maxN > 1 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-text-muted">
                            数量
                          </p>
                          <Segmented
                            aria-label="生成数量"
                            value={String(params.n)}
                            onChange={(value) =>
                              onParamsChange({ n: Number(value) })
                            }
                            className="flex [&_button]:h-10 [&_button]:flex-1"
                            options={Array.from(
                              { length: maxN },
                              (_, index) => ({
                                value: String(index + 1),
                                label: String(index + 1) + " 张",
                              }),
                            )}
                          />
                        </div>
                      ) : null}
                      {outputFormats.length > 1 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-text-muted">
                            图片格式
                          </p>
                          <Select
                            aria-label="图片格式"
                            value={
                              params.outputFormat ??
                              model?.defaults.outputFormat
                            }
                            onValueChange={(outputFormat) =>
                              onParamsChange({ outputFormat })
                            }
                            options={outputFormats.map((format) => ({
                              value: format,
                              label: format.toUpperCase(),
                            }))}
                            controlSize="lg"
                          />
                        </div>
                      ) : null}
                      {model?.capabilities.supportsNegativePrompt ? (
                        <label className="block space-y-2 text-xs text-text-muted">
                          <span>排除内容</span>
                          <Textarea
                            aria-label="排除内容"
                            value={params.negativePrompt ?? ""}
                            onChange={(event) =>
                              onParamsChange({
                                negativePrompt: event.target.value,
                              })
                            }
                            rows={2}
                            className="resize-none text-sm"
                          />
                        </label>
                      ) : null}
                      {model?.capabilities.supportsSeed ? (
                        <label className="block space-y-2 text-xs text-text-muted">
                          <span>种子</span>
                          <Input
                            type="number"
                            aria-label="种子"
                            value={params.seed ?? ""}
                            onChange={(event) =>
                              onParamsChange({
                                seed:
                                  event.target.value === ""
                                    ? undefined
                                    : Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                    <div className="mt-5 space-y-1 border-t border-border pt-3">
                      {!isAgent ? (
                        <Button
                          variant="ghost"
                          type="button"
                          disabled={busy || optimizing || !prompt.trim()}
                          onClick={() => {
                            setParamsOpen(false);
                            onOptimize();
                          }}
                          className="h-11 w-full justify-start gap-3 px-2 text-sm"
                        >
                          <Wand2 size={17} />
                          {optimizing ? "正在优化…" : "优化提示词"}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          setParamsOpen(false);
                          setExpanded(true);
                        }}
                        className="h-11 w-full justify-start gap-3 px-2 text-sm"
                        aria-label="展开提示词编辑"
                      >
                        <Maximize2 size={17} />
                        展开编辑
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>

            {isChat ? (
              <ChatModelControls
                models={chatModels}
                model={chatModel}
                reasoningEffort={chatReasoningEffort}
                onSelectModel={onSelectChatModel}
                onReasoningEffortChange={onChatReasoningEffortChange}
                disabled={busy || optimizing || uploading > 0}
              />
            ) : null}

            {!isChat ? (
              <div className="col-span-3 col-start-1 row-start-1 min-w-0 sm:col-span-1 sm:col-start-2">
                <DropdownMenu
                  className="studio-workspace max-h-[50dvh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto"
                  trigger={
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={
                        "选择模型，当前 " + (model?.displayName ?? "未选择")
                      }
                      title={model?.displayName ?? "选择模型"}
                      disabled={uploading > 0 || busy}
                      className="h-9 w-full min-w-0 justify-between gap-2 border-border bg-surface-2 px-3 text-xs text-foreground hover:bg-surface-3 sm:max-w-56"
                    >
                      <ImageIcon
                        size={14}
                        className="shrink-0 text-text-muted"
                      />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {model?.displayName ?? "选择模型"}
                      </span>
                      <ChevronDown
                        size={15}
                        className="shrink-0 text-text-muted"
                      />
                    </Button>
                  }
                >
                  {models.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      className="h-auto min-h-11 py-2 [&>span]:w-full [&>span]:whitespace-normal"
                      disabled={!item.available}
                      onClick={() => onSelectModel(item.id)}
                    >
                      <span className="flex w-full items-center justify-between gap-3 py-1">
                        <span className="min-w-0 break-words">
                          {item.displayName}
                        </span>
                        {item.id === model?.id ? <Check size={14} /> : null}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              </div>
            ) : null}

            <div
              className={cn(
                "flex min-w-0 justify-end text-xs text-text-muted",
                isChat
                  ? "hidden"
                  : "col-start-2 row-start-2 sm:col-start-3 sm:row-start-1",
              )}
            >
              {!isChat ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setParamsOpen(true)}
                  title="调整尺寸、质量和数量"
                  aria-label="调整尺寸、质量和数量"
                  className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed"
                >
                  <Ratio size={14} className="hidden shrink-0 sm:block" />
                  <span className="truncate">
                    {(selectedSize === "auto" ? "自动尺寸" : selectedSize) +
                      (qualities.length > 1
                        ? " · " + qualityLabel(selectedQuality)
                        : "") +
                      " · " +
                      (isAgent ? 1 : params.n) +
                      " 张"}
                  </span>
                </button>
              ) : null}
            </div>
            <div
              className={cn(
                "col-start-3 flex shrink-0 items-center gap-1 justify-self-end sm:col-start-4",
                isChat ? "row-start-1" : "row-start-2 sm:row-start-1",
              )}
            >
              {isChat ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  aria-label="展开消息编辑"
                  title="展开编辑"
                  disabled={busy}
                  onClick={() => setExpanded(true)}
                  className={cn(
                    toolClass,
                    "hidden sm:inline-flex sm:h-9 sm:w-9",
                  )}
                >
                  <Maximize2 size={16} />
                </IconButton>
              ) : null}
              {onStop ? (
                <IconButton
                  variant="ghost"
                  size="lg"
                  aria-label="停止回复"
                  title="停止回复"
                  onClick={onStop}
                  className="h-11 w-11 rounded-full border-transparent bg-foreground text-background hover:bg-foreground/85 sm:h-10 sm:w-10"
                >
                  <Square size={15} fill="currentColor" />
                </IconButton>
              ) : !isChat && !isAgent && onGenerateImage ? (
                /* image 模式：两个按钮并排 — 对话发送 + 专用生图 */
                <div className="flex items-center gap-1.5">
                  {/* 对话发送 */}
                  <IconButton
                    variant="ghost"
                    size="lg"
                    type="button"
                    onClick={onSubmit}
                    disabled={submitDisabled}
                    aria-label="发送对话"
                    title={disabledReason ?? "发送对话"}
                    aria-busy={busy || undefined}
                    className={cn(
                      "studio-submit h-10 w-10 rounded-full p-0",
                      submitDisabled
                        ? "border-transparent bg-surface-2 text-text-faint"
                        : "border border-border bg-surface text-foreground hover:bg-surface-2",
                    )}
                  >
                    {busy ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <ArrowUp size={18} strokeWidth={2.2} />
                    )}
                  </IconButton>
                  {/* 专用生图按钮 */}
                  <button
                    type="button"
                    onClick={onGenerateImage}
                    disabled={generateDisabled}
                    aria-label="生成图片"
                    title={disabledReason ?? "生成图片"}
                    className={cn(
                      "dock-generate-btn inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-all",
                      generateDisabled
                        ? "cursor-not-allowed bg-surface-2 text-text-faint"
                        : "bg-[rgb(var(--studio-highlight))] text-[rgb(var(--studio-highlight-ink))] hover:opacity-90 active:scale-95",
                    )}
                  >
                    <Sparkles size={14} />
                    生图
                  </button>
                </div>
              ) : (
                <IconButton
                  variant="ghost"
                  size="lg"
                  type="button"
                  onClick={onSubmit}
                  disabled={submitDisabled}
                  aria-label={
                    isAgent ? "发送给 Agent" : isChat ? "发送" : "生成"
                  }
                  title={
                    disabledReason ??
                    (isChat ? chatStatus : null) ??
                    (isAgent ? "发送给 Agent" : isChat ? "发送" : "生成")
                  }
                  aria-busy={busy || undefined}
                  className={cn(
                    "studio-submit h-11 w-11 rounded-md p-0 sm:h-10 sm:w-10",
                    isChat && "rounded-full",
                    submitDisabled
                      ? "border-transparent bg-surface-2 text-text-faint aria-disabled:border-transparent aria-disabled:bg-surface-2"
                      : isChat
                        ? "border-transparent bg-foreground text-background hover:bg-foreground/85 hover:text-background"
                        : "border-transparent bg-[rgb(var(--studio-highlight,var(--brand-primary)))] text-[rgb(var(--studio-highlight-ink,var(--on-accent)))] hover:bg-[rgb(var(--studio-highlight,var(--brand-primary)))]/85 hover:text-[rgb(var(--studio-highlight-ink,var(--on-accent)))]",
                  )}
                >
                  {busy ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <ArrowUp size={20} strokeWidth={2.2} />
                  )}
                </IconButton>
              )}
            </div>
          </div>
        </div>
      </ReferenceDropZone>
      {isChat && chatTools ? (
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 px-1 text-[11px] text-text-faint sm:min-h-8">
          <div className="flex min-w-0 items-center gap-0.5">{chatTools}</div>
          <span className="ml-auto whitespace-nowrap tabular-nums">
            {chatModel ? `${chatModel.credits} 积分 / 轮` : ""}
          </span>
        </div>
      ) : (
        <div className="flex h-4 items-center justify-between px-1 text-[11px] text-text-faint">
          <span>
            {optimizing
              ? "正在优化提示词…"
              : uploading
                ? "参考图上传中…"
                : isChat && chatModel
                  ? `${chatModel.credits} 积分 / 轮`
                  : ""}
          </span>
          <span className={cn("tabular-nums", !prompt.length && "invisible")}>
            {prompt.length}/4000
          </span>
        </div>
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          aria-describedby={undefined}
          className="w-[calc(100vw-2rem)] max-w-2xl space-y-4 p-5"
        >
          <DialogTitle>{isChat ? "编辑消息" : "编辑提示词"}</DialogTitle>
          <Textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            maxLength={4000}
            aria-label="展开的提示词"
            className="h-[min(50dvh,400px)] resize-none text-sm leading-7"
          />
          <div className="flex items-center justify-end gap-3">
            <CopyTextButton text={prompt} />
            <Button onClick={() => setExpanded(false)}>完成</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
