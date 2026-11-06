"use client";

import Link from "next/link";
import { MessagesSquare, Presentation, Sparkles, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type WorkbenchView = "studio" | "ppt" | "chat";

export function ToolbarIconButton({
  icon: Icon,
  label,
  shortcut,
  variant,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  variant?: "default" | "accent";
  onClick?: () => void;
  href?: string;
}): React.ReactElement {
  const isAccent = variant === "accent";
  const baseClasses =
    "group relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 ease-[var(--ease-out)] hover:scale-[1.04] active:scale-[0.96]";
  const variantClasses = isAccent
    ? "border border-ink bg-ink text-background hover:border-brand hover:bg-brand hover:text-on-brand"
    : "bg-transparent text-text-muted hover:bg-ink/[0.07] hover:text-foreground";
  const classes = cn(baseClasses, variantClasses);

  const content = (
    <>
      <Icon size={17} strokeWidth={1.8} />
      <span className="pointer-events-none absolute -bottom-10 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-ink/[0.09] bg-surface-2/95 px-2.5 py-1.5 text-[11px] font-medium text-foreground opacity-0 shadow-[var(--shadow-md)] transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
        {shortcut ? (
          <kbd className="ml-1.5 rounded border border-ink/[0.12] px-1 font-mono text-[10px]">
            {shortcut}
          </kbd>
        ) : null}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={label}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes} aria-label={label}>
      {content}
    </button>
  );
}

export function ViewSwitcher({
  view,
  onChange,
}: {
  view: WorkbenchView;
  onChange: (view: WorkbenchView) => void;
}): React.ReactElement {
  const segments: Array<{
    id: WorkbenchView;
    label: string;
    icon: LucideIcon;
  }> = [
    { id: "studio", label: "单图生成", icon: Sparkles },
    { id: "chat", label: "对话", icon: MessagesSquare },
    { id: "ppt", label: "PPT 生成", icon: Presentation },
  ];

  return (
    <div
      role="tablist"
      aria-label="工作台视图"
      className="flex h-9 items-center gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1"
    >
      {segments.map(({ id, label, icon: Icon }) => {
        const isActive = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={cn(
              "group flex h-7 items-center gap-1.5 rounded-[3px] px-3 text-[12.5px] font-medium transition-colors duration-150 ease-[var(--ease-out)] active:scale-[0.97]",
              isActive
                ? "bg-ink text-background"
                : "text-text-muted hover:text-foreground",
            )}
          >
            <Icon
              size={14}
              strokeWidth={1.8}
              className={cn(
                "transition-all duration-200",
                isActive ? "text-brand" : "group-hover:scale-110",
              )}
            />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ModelMiniSelector({
  models,
  activeId,
  onChange,
}: {
  models: Array<{ id: string; displayName: string; available: boolean }>;
  activeId: string;
  onChange: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="border-b border-border px-4 py-3">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
        模型
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {models.map((model) => (
          <button
            key={model.id}
            type="button"
            onClick={() => onChange(model.id)}
            disabled={!model.available}
            className={cn(
              "rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11.5px] transition-colors duration-150",
              model.id === activeId
                ? "border-ink bg-ink text-background"
                : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-foreground",
              !model.available && "opacity-40",
            )}
          >
            {model.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}
