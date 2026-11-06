"use client";

import {
  Layers,
  MessageSquarePlus,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
} from "lucide-react";

import {
  ToolbarIconButton,
  ViewSwitcher,
  type WorkbenchView,
} from "@/components/workbench/WorkbenchShellControls";
import type { WorkbenchState } from "@/components/workbench/types";
import type { PublicModelDefinition } from "@/lib/models/types";
import { IMAGE_SIZE_LABEL } from "@/lib/models/options";

interface WorkbenchShellTopBarProps {
  conversationTitle: string;
  isCanvasMode: boolean;
  model: PublicModelDefinition | null;
  state: WorkbenchState | null;
  view: WorkbenchView;
  onNewConversation: () => void;
  onToggleConversations: () => void;
  onToggleParams: () => void;
  onViewChange: (view: WorkbenchView) => void;
}

export function WorkbenchShellTopBar({
  conversationTitle,
  isCanvasMode,
  model,
  state,
  view,
  onNewConversation,
  onToggleConversations,
  onToggleParams,
  onViewChange,
}: WorkbenchShellTopBarProps): React.ReactElement {
  return (
    <div className="relative z-30 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink/[0.06] bg-background/70 px-4 py-3 md:px-6">
      <button
        type="button"
        className="group flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full border border-ink/[0.08] bg-ink/[0.04] px-3 text-[12.5px] text-foreground transition-all duration-200 hover:border-ink/[0.16] hover:bg-ink/[0.07] active:scale-[0.98] sm:max-w-[260px]"
        onClick={onToggleConversations}
        aria-label="对话切换"
      >
        <Layers size={13} strokeWidth={1.5} className="text-text-muted" />
        <span className="max-w-[180px] truncate font-medium">
          {conversationTitle}
        </span>
        <span className="hidden font-mono text-[10px] text-text-faint sm:inline">
          ⌘K
        </span>
      </button>

      {isCanvasMode ? (
        <div className="pointer-events-none flex h-9 items-center gap-2 rounded-full border border-ink/[0.08] bg-ink/[0.04] px-4 text-sm font-medium text-foreground">
          <Layers className="h-4 w-4 text-brand-soft" />
          无限画布
        </div>
      ) : (
        <ViewSwitcher view={view} onChange={onViewChange} />
      )}

      <div className="flex max-w-full items-center gap-0 rounded-full border border-ink/[0.08] bg-ink/[0.04] p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
        <button
          type="button"
          onClick={onToggleParams}
          className="group relative flex h-9 min-w-0 items-center gap-2 rounded-full px-3 text-[12.5px] transition-all duration-200 hover:bg-ink/[0.07] active:scale-[0.98]"
          aria-label="模型信息"
        >
          <Sparkles
            size={15}
            strokeWidth={1.8}
            className="text-brand transition-colors duration-150"
          />
          <div className="flex flex-col items-start gap-0.5">
            <span className="max-w-[120px] truncate font-semibold leading-none text-foreground sm:max-w-[140px]">
              {model?.displayName ?? "无模型"}
            </span>
            {state ? (
              <span className="font-mono text-[10px] leading-none text-text-faint">
                {state.n}×{IMAGE_SIZE_LABEL[state.size]}
              </span>
            ) : null}
          </div>
          <span className="pointer-events-none absolute -bottom-10 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-ink/[0.09] bg-surface-2/95 px-2.5 py-1.5 text-[11px] font-medium text-foreground opacity-0 shadow-[var(--shadow-md)] transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-visible:opacity-100">
            调整参数
            <kbd className="ml-1.5 rounded border border-ink/[0.12] px-1 font-mono text-[10px]">
              ⌘/
            </kbd>
          </span>
        </button>

        <div
          className="mx-1 h-4 w-px self-center bg-ink/[0.1]"
          aria-hidden="true"
        />

        <ToolbarIconButton
          icon={Sliders}
          label="参数"
          shortcut="⌘/"
          variant="accent"
          onClick={onToggleParams}
        />
        <ToolbarIconButton
          icon={MessageSquarePlus}
          label="新建对话"
          onClick={onNewConversation}
        />
        <ToolbarIconButton
          icon={SettingsIcon}
          label="设置"
          href="/app/settings"
        />
      </div>
    </div>
  );
}
