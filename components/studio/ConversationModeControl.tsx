"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONVERSATION_MODE_LABELS,
  DEFAULT_CONVERSATION_MODE,
  normalizeConversationMode,
  type ConversationMode,
} from "@/lib/chat-conversation-mode";
import { cn } from "@/lib/utils";

const ORDER: ConversationMode[] = ["dialogue", "listen", "detail"];

const HINTS: Record<ConversationMode, string> = {
  dialogue: "对谈：一来一回，每次一到三句",
  listen: "倾听：你说它听，需要时才简短回应",
  detail: "详答：完整的长回答",
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

export function ConversationModeControl({
  mode,
  onChange,
  disabled,
}: {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="对话模式"
      className="inline-flex h-7 items-center rounded-md bg-surface-2 p-0.5"
    >
      {ORDER.map((item) => {
        const active = item === mode;
        return (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={active}
            title={HINTS[item]}
            disabled={disabled}
            onClick={() => onChange(item)}
            className={cn(
              "h-6 rounded-[5px] px-2 text-[11px] transition-colors disabled:opacity-50",
              active
                ? "bg-surface text-foreground shadow-sm"
                : "text-text-muted hover:text-foreground",
            )}
          >
            {CONVERSATION_MODE_LABELS[item]}
          </button>
        );
      })}
    </div>
  );
}
