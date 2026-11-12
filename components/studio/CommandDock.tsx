"use client";

import {
  ArrowUp,
  Check,
  ChevronDown,
  ImageIcon,
  Maximize2,
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
import { ChatModelControls, ChatModelPrice } from "./ChatModelControls";
import { REFERENCE_ACCEPT } from "./lib/reference-input";
import { resolveGenerationOptions } from "./lib/generation-options";
import { parseImageCommand } from "@/lib/image-command";

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
  disabledReason,
  uploading = 0,
  onAddReference = () => undefined,
  focusVersion = 0,
  mode,
  onStop,
  chatModels = [],
  chatModel = null,
  chatReasoningEffort,
  onSelectChatModel = () => undefined,
  onChatReasoningEffortChange = () => undefined,
  chatUnavailableReason,
  onRetryChatModels,
  centered = false,
  chatTools,
}: CommandDockProps) {
  const [expanded, setExpanded] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [commandsDismissed, setCommandsDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAgent = mode === "agent";
  const isChat = !isAgent;
  const imageCommand = parseImageCommand(prompt);
  const showImageCommand =
    !commandsDismissed &&
    prompt.startsWith("/") &&
    ["/生图", "/image"].some((command) =>
      command.startsWith(prompt.toLowerCase()),
    );
  const completeImageCommand = () => {
    onPromptChange("/生图 ");
    setCommandsDismissed(true);
    textareaRef.current?.focus();
  };
  const maxN = isAgent ? 1 : Math.min(model?.capabilities.maxN ?? 1, 4);
  const {
    sizes,
    size: selectedSize,
    outputFormat: selectedFormat,
  } = resolveGenerationOptions(model, params);
  const qualities = model?.capabilities.qualities ?? [];
  const outputFormats = model?.capabilities.outputFormats ?? [];
  const supportsReference =
    isChat && !imageCommand
      ? (chatModel?.supportsVision ?? false)
      : (model?.capabilities.supportsReferenceImage ?? false);
  const maxReferences =
    isChat && !imageCommand
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
    (isChat && !imageCommand ? !chatModel || Boolean(chatStatus) : !model) ||
    Boolean(imageCommand && !imageCommand.prompt.trim()) ||
    !prompt.trim();
  const toolClass =
    "h-9 w-9 shrink-0 rounded-md border-transparent bg-transparent p-0 text-text-muted hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 aria-disabled:border-transparent aria-disabled:bg-transparent";
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
    <div className="space-y-2">
      {isChat && !imageCommand && chatStatus ? (
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
        className="smooth-surface dock-shell studio-composer rounded-2xl"
      >
        <ReferenceThumbnails
          references={params.referenceImages}
          uploading={uploading}
          onRemove={onRemoveReference}
        />
        <div className="space-y-2 p-3 sm:p-4 sm:pb-3">
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
              rows={1}
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
              onChange={(event) => {
                setCommandsDismissed(false);
                onPromptChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCommandsDismissed(true);
                if (
                  showImageCommand &&
                  ["Enter", "Tab"].includes(event.key) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  completeImageCommand();
                  return;
                }
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
                "block max-h-[180px] w-full min-w-0 resize-none rounded-none border-0 bg-transparent p-0 text-[15px] leading-6 shadow-none outline-none placeholder:text-text-faint hover:border-transparent hover:bg-transparent focus:border-transparent focus:shadow-none focus:ring-0 focus-visible:ring-0 disabled:bg-transparent sm:min-h-14",
                "min-h-12",
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
          {showImageCommand ? (
            <div
              role="listbox"
              aria-label="命令"
              className="border-t border-border pt-2"
            >
              <button
                type="button"
                role="option"
                aria-selected="true"
                onClick={completeImageCommand}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground hover:bg-surface-2"
              >
                <ImageIcon size={16} /> /生图
              </button>
            </div>
          ) : null}
          {imageCommand && !imageCommand.prompt.trim() ? (
            <p role="alert" className="text-xs text-text-muted">
              请在 /生图 后输入提示词
            </p>
          ) : null}

          <div className="studio-input-tools" aria-label="输入工具栏">
            <div
              className={cn(
                "studio-attachment-tools flex shrink-0 items-center gap-0.5",
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
              {
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
                          图片模型
                        </p>
                        <Select
                          aria-label="图片模型"
                          value={model?.id ?? ""}
                          onValueChange={onSelectModel}
                          options={models.map((item) => ({
                            value: item.id,
                            label: item.displayName,
                            disabled: !item.available,
                          }))}
                          controlSize="lg"
                        />
                      </div>
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
                            value={selectedFormat}
                            onValueChange={(outputFormat) => {
                              const next = resolveGenerationOptions(model, {
                                ...params,
                                outputFormat,
                              });
                              onParamsChange({
                                outputFormat: next.outputFormat,
                                size: next.size,
                              });
                            }}
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
                      {!isChat && !isAgent ? (
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
              }
            </div>

            {isChat && !imageCommand ? (
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
              <div className="studio-model-container">
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
                      className="smooth-surface studio-model-trigger h-9 w-full min-w-0 justify-between gap-2 border-transparent bg-surface-2 px-3 text-[13px] text-foreground hover:bg-surface-3 sm:w-auto sm:max-w-56"
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
                "studio-parameter-summary flex min-w-0 justify-end text-xs text-text-muted",
                isChat ? "hidden" : "",
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
                "studio-submit-tools flex shrink-0 items-center gap-1",
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
                  className="h-9 w-9 rounded-full border-transparent bg-foreground text-background hover:bg-foreground/85"
                >
                  <Square size={15} fill="currentColor" />
                </IconButton>
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
                    (isChat && !imageCommand ? chatStatus : null) ??
                    (isAgent ? "发送给 Agent" : isChat ? "发送" : "生成")
                  }
                  aria-busy={busy || undefined}
                  className={cn(
                    "studio-submit h-9 w-9 rounded-md p-0",
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
      {isChat && !imageCommand && chatTools ? (
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-2 px-1 text-[11px] leading-4 text-text-faint">
          <div className="flex min-w-0 items-center gap-0">{chatTools}</div>
          <ChatModelPrice model={chatModel} className="ml-auto text-[11px]" />
        </div>
      ) : (
        <div className="flex min-h-6 items-start justify-between gap-2 px-1 text-[11px] leading-4 text-text-faint">
          <span className="min-w-0">
            {optimizing ? (
              "正在优化提示词…"
            ) : uploading ? (
              "参考图上传中…"
            ) : isChat && !imageCommand && chatModel ? (
              <ChatModelPrice model={chatModel} />
            ) : (
              ""
            )}
          </span>
          <span
            className={cn(
              "shrink-0 tabular-nums",
              !prompt.length && "invisible",
            )}
          >
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
