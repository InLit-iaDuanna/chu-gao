"use client";

import * as RadixMenu from "@radix-ui/react-dropdown-menu";

import { cn } from "@/lib/utils";

import { Kbd } from "./Kbd";

interface DropdownMenuProps {
  trigger: React.ReactElement;
  children: React.ReactNode;
  className?: string;
}

interface DropdownMenuItemProps {
  children: React.ReactNode;
  className?: string;
  shortcut?: string;
  disabled?: boolean;
  /** Fired on both pointer click and keyboard (Enter/Space) selection. */
  onClick?: () => void;
  onSelect?: (event: Event) => void;
}

/**
 * Accessible menu built on Radix DropdownMenu — focusable trigger with
 * aria-haspopup/expanded, roving arrow-key navigation, typeahead, Esc + focus
 * restore. The public API (trigger / children / className) is unchanged.
 */
export function DropdownMenu({
  trigger,
  children,
  className,
}: DropdownMenuProps): React.ReactElement {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 min-w-48 rounded-[var(--radius-lg)] border border-border bg-surface p-1 shadow-[var(--shadow-lg)] outline-none",
            className,
          )}
        >
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

export function DropdownMenuItem({
  className,
  children,
  shortcut,
  disabled,
  onClick,
  onSelect,
}: DropdownMenuItemProps): React.ReactElement {
  return (
    <RadixMenu.Item
      disabled={disabled}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center justify-between gap-6 rounded-[3px] px-2.5 text-left text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-ink data-[highlighted]:text-background data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45",
        className,
      )}
      onSelect={(event) => {
        onSelect?.(event);
        onClick?.();
      }}
    >
      <span className="flex min-w-0 items-center gap-2 truncate">
        {children}
      </span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </RadixMenu.Item>
  );
}

export function DropdownMenuSeparator(): React.ReactElement {
  return <RadixMenu.Separator className="my-1 h-px bg-border" />;
}
