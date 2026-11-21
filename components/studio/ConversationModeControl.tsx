"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  Check,
  ChevronDown,
  Ear,
  FileText,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import {
  CONVERSATION_MODE_LABELS,
  DEFAULT_CONVERSATION_MODE,
  normalizeConversationMode,
  type ConversationMode,
} from "@/lib/chat-conversation-mode";
import { cn } from "@/lib/utils";

const ORDER: ConversationMode[] = ["dialogue", "listen", "detail"];

const DESCRIPTIONS: Record<ConversationMode, string> = {
  dialogue: "一来一回地讨论，每次一到三句",
  listen: "你来说，它听；需要时才简短回应",
  detail: "完整展开的长回答",
};

const HINTS: Record<ConversationMode, string> = {
  dialogue: `对话模式：对谈 · ${DESCRIPTIONS.dialogue}`,
  listen: `对话模式：倾听 · ${DESCRIPTIONS.listen}`,
  detail: `对话模式：详答 · ${DESCRIPTIONS.detail}`,
};

const storageKey = (conversationId: string) =>
  `chugao.chat-mode.v1.${encodeURIComponent(conversationId)}`;

function readStored(conversationId: string): ConversationMode | null {
  try {
    const raw = localStorage.getItem(storageKey(conversationId));
    return raw ? normalizeConversationMode(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(conversationId: string, mode: ConversationMode) {
  try {
    if (mode === DEFAULT_CONVERSATION_MODE)
      localStorage.removeItem(storageKey(conversationId));
    else localStorage.setItem(storageKey(conversationId), mode);
  } catch {
    // Storage is a convenience; the mode still applies to this session.
  }
}

/**
 * The conversation mode remembered per conversation (browser storage). A new
 * chat starts in 详答; the mode picked before its first message carries over
 * to the conversation that message creates.
 */
export function useConversationMode(activeId: string | null) {
  const [mode, setModeState] = useState<ConversationMode>(
    DEFAULT_CONVERSATION_MODE,
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const previousId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const previous = previousId.current;
    previousId.current = activeId;
    if (!activeId) {
      if (previous) setModeState(DEFAULT_CONVERSATION_MODE);
      return;
    }
    const stored = readStored(activeId);
    if (stored) setModeState(stored);
    else if (previous === null) writeStored(activeId, modeRef.current);
    else setModeState(DEFAULT_CONVERSATION_MODE);
  }, [activeId]);

  const setMode = useCallback(
    (next: ConversationMode) => {
      setModeState(next);
      if (activeId) writeStored(activeId, next);
    },
    [activeId],
  );

  return [mode, setMode] as const;
}

const ICONS: Record<ConversationMode, LucideIcon> = {
  dialogue: MessagesSquare,
  listen: Ear,
  detail: FileText,
};

const panel =
  "studio-workspace z-50 w-[min(264px,calc(100vw-24px))] rounded-xl border border-border bg-surface p-1.5 text-foreground outline-none";
const row =
  "relative flex min-h-12 w-full cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";

/**
 * 对谈 / 倾听 / 详答 picker for the chat tools row. The trigger stays quiet
 * in 详答 and shows the mode on a filled chip otherwise, so a short-reply
 * conversation is always recognisable at a glance.
 */
export function ConversationModeControl({
  mode,
  onChange,
  disabled,
}: {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
  disabled?: boolean;
}) {
  const Icon = ICONS[mode];
  const active = mode !== DEFAULT_CONVERSATION_MODE;
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        type="button"
        disabled={disabled}
        aria-label={`对话模式：${CONVERSATION_MODE_LABELS[mode]}`}
        title={HINTS[mode]}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50",
          active
            ? "bg-surface-2 text-foreground hover:bg-surface-3"
            : "text-text-muted hover:text-foreground data-[state=open]:text-foreground",
        )}
      >
        <Icon size={14} strokeWidth={1.8} className="shrink-0" />
        {CONVERSATION_MODE_LABELS[mode]}
        <ChevronDown size={12} strokeWidth={1.8} className="shrink-0 opacity-70" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="对话模式"
          className={panel}
        >
          <p className="px-2.5 pb-1 pt-1 text-[11px] leading-4 text-text-faint">
            对话模式
          </p>
          <Menu.RadioGroup
            value={mode}
            onValueChange={(value) => onChange(normalizeConversationMode(value))}
          >
            {ORDER.map((item) => {
              const ItemIcon = ICONS[item];
              return (
                <Menu.RadioItem
                  key={item}
                  value={item}
                  textValue={CONVERSATION_MODE_LABELS[item]}
                  className={row}
                >
                  <ItemIcon
                    size={16}
                    strokeWidth={1.7}
                    className="shrink-0 text-text-muted"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm leading-5">
                      {CONVERSATION_MODE_LABELS[item]}
                      {item === DEFAULT_CONVERSATION_MODE ? (
                        <span className="text-xs text-text-faint">默认</span>
                      ) : null}
                    </span>
                    <span className="block text-xs leading-4 text-text-faint">
                      {DESCRIPTIONS[item]}
                    </span>
                  </span>
                  <Menu.ItemIndicator className="shrink-0">
                    <Check size={16} strokeWidth={2} />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              );
            })}
          </Menu.RadioGroup>
          <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
          <p className="px-2.5 pb-1 text-[11px] leading-4 text-text-faint">
            下一条消息起生效，每个对话分别记住。配 Low 思考强度回应最快。内测中，仅管理员可见。
          </p>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
