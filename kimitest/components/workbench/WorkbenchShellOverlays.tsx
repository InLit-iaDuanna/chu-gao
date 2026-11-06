"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Sliders, Trash2, X } from "lucide-react";

import {
  DynamicParamsPanel,
  normalizeWorkbenchState,
} from "@/components/workbench/DynamicParamsPanel";
import { ModelMiniSelector } from "@/components/workbench/WorkbenchShellControls";
import type { WorkbenchState } from "@/components/workbench/types";
import type { ConversationSummaryView } from "@/lib/conversation";
import type { PublicModelDefinition } from "@/lib/models/types";
import { cn } from "@/lib/utils";

type SetWorkbenchState = (
  next:
    | WorkbenchState
    | null
    | ((current: WorkbenchState | null) => WorkbenchState | null),
) => void;

export function ParameterPopover({
  open,
  state,
  models,
  availableModels,
  isBooting,
  onClose,
  onStateChange,
}: {
  open: boolean;
  state: WorkbenchState | null;
  models: PublicModelDefinition[];
  availableModels: PublicModelDefinition[];
  isBooting: boolean;
  onClose: () => void;
  onStateChange: SetWorkbenchState;
}): React.ReactElement {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="params"
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="absolute right-4 top-16 z-40 w-[min(360px,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-[18px] border border-ink/[0.09] bg-surface-2/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-lg)]"
        >
          <div className="flex items-center justify-between border-b border-ink/[0.07] px-4 py-3">
            <div className="flex items-center gap-2">
              <Sliders size={13} strokeWidth={1.5} className="text-text-muted" />
              <span className="text-[13px] font-medium">生成参数</span>
            </div>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
          {state ? (
            <div className="max-h-[70vh] overflow-y-auto">
              <ModelMiniSelector
                models={availableModels}
                activeId={state.modelId}
                onChange={(id) => {
                  onStateChange((current) =>
                    current ? normalizeWorkbenchState(id, current, models) : current,
                  );
                }}
              />
              <DynamicParamsPanel
                value={state}
                onChange={onStateChange}
                models={models}
              />
            </div>
          ) : (
            <div className="p-4 text-[13px] text-text-muted">
              {isBooting
                ? "正在读取模型列表..."
                : "当前没有可用模型。请先在设置中启用渠道。"}
            </div>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function ConversationListPopover({
  open,
  conversations,
  activeId,
  onClose,
  onClearAll,
  onArchive,
}: {
  open: boolean;
  conversations: ConversationSummaryView[];
  activeId: string | null;
  onClose: () => void;
  onClearAll: () => void | Promise<void>;
  onArchive: (id: string) => void | Promise<void>;
}): React.ReactElement {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="conv"
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="absolute left-4 top-16 z-40 w-[min(320px,calc(100vw-2rem))] origin-top-left overflow-hidden rounded-[18px] border border-ink/[0.09] bg-surface-2/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-lg)]"
        >
          <div className="flex items-center justify-between border-b border-ink/[0.07] px-4 py-3">
            <span className="text-[13px] font-medium">对话</span>
            <button
              type="button"
              onClick={() => {
                void onClearAll();
              }}
              disabled={conversations.length === 0}
              className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-text-muted hover:bg-surface-2 disabled:opacity-30"
            >
              <Trash2 size={11} strokeWidth={1.5} />
              清空
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1">
            {conversations.length === 0 ? (
              <p className="p-4 text-[13px] text-text-muted">
                发送第一条消息后会自动创建对话。
              </p>
            ) : (
              conversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/app?conversation=${conversation.id}`}
                  onClick={onClose}
                  className={cn(
                    "group flex items-start gap-2 rounded-[12px] px-3 py-2 transition-colors",
                    conversation.id === activeId
                      ? "bg-[rgb(var(--brand-primary))]/12 text-foreground shadow-[inset_0_0_0_1px_rgb(var(--brand-primary)/0.3)]"
                      : "text-text-muted hover:bg-ink/[0.05] hover:text-foreground",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {conversation.title}
                    </p>
                    {conversation.latestMessage ? (
                      <p className="mt-0.5 line-clamp-1 text-[11.5px] opacity-70">
                        {conversation.latestMessage}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onArchive(conversation.id);
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint opacity-0 transition-all hover:bg-surface hover:text-foreground group-hover:opacity-100"
                    aria-label="删除"
                  >
                    <Trash2 size={11} strokeWidth={1.5} />
                  </button>
                </Link>
              ))
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function CompletionToast({
  message,
  hasActivePrompt,
}: {
  message: string | null;
  hasActivePrompt: boolean;
}): React.ReactElement {
  return (
    <AnimatePresence>
      {message ? (
        <motion.div
          key="toast"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 rounded-full border border-ink/[0.1] bg-surface-2/85 px-4 py-2 text-[12.5px] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-md),0_0_24px_-8px_rgb(var(--brand-primary)/0.4)]",
            hasActivePrompt ? "bottom-[22rem] md:bottom-[30rem]" : "bottom-44",
          )}
        >
          <span className="font-mono">{message}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
