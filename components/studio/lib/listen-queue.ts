"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ListenReaction } from "@/lib/chat-listen-react";

import type { XiieCue } from "../chat/Xiie";
import { request } from "./api";

/**
 * How long the input box must stay empty and untouched before the lines
 * said so far go to the model together.
 */
export const LISTEN_IDLE_MS = 6_000;
/** Text left in the box this long without a keystroke counts as hesitating. */
export const LISTEN_STALL_MS = 20_000;
/** This many separate erasures of a few characters count as rewriting. */
export const LISTEN_REWRITES = 3;
/** An erasure only counts once at least this many characters went. */
const ERASE_CHARS = 4;

export type ListenNudgeReason = "stalled" | "rewriting";

/** Asks the main model for one short line; null when it has nothing to say. */
export async function requestListenNudge(input: {
  conversationId: string;
  modelId: string;
  reason: ListenNudgeReason;
}): Promise<string | null> {
  try {
    const result = await request<{ line: string | null }>(
      "/api/chat/listen-nudge",
      { method: "POST", body: JSON.stringify(input) },
    );
    return result.line?.trim() || null;
  } catch {
    return null;
  }
}

/** How each reaction shows on Xiie; plain listening adds nothing. */
export const LISTEN_REACTION_CUES: Record<
  ListenReaction,
  XiieCue["kind"] | null
> = {
  listen: null,
  nod: "nod",
  care: "heart",
  happy: "star",
  wow: "bang",
  curious: "ask",
};

/**
 * Xiie's quick reaction to the lines said so far in this stretch; null when
 * there is none (no reaction set up, or the call failed).
 */
export async function requestListenReaction(input: {
  conversationId: string | null;
  lines: string[];
  /** What Xiie already murmured in this stretch, so it does not repeat. */
  murmurs: string[];
}): Promise<{ reaction: ListenReaction; line: string | null } | null> {
  try {
    const result = await request<{
      reaction: ListenReaction | null;
      line: string | null;
    }>("/api/chat/listen-react", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!result.reaction) return null;
    return { reaction: result.reaction, line: result.line?.trim() || null };
  } catch {
    return null;
  }
}

/**
 * 倾听 as a full-duplex conversation: the user keeps talking line after line
 * without waiting for the assistant. Lines pile up here and go out as one
 * message once the box has been empty and still for a while and no reply is
 * in flight, so a burst of short lines costs one model call. While the user
 * is typing nothing is sent; if they hesitate (text sits untouched, or they
 * keep writing and erasing) `onNudge` fires once per stretch of talk.
 */
export function useListenQueue({
  enabled,
  busy,
  draft,
  conversationKey,
  flush,
  onNudge,
}: {
  enabled: boolean;
  /** A reply is in flight; new lines wait for it. */
  busy: boolean;
  /** What the user is typing right now. */
  draft: string;
  /** Lines never follow the user into another conversation. */
  conversationKey: string | null;
  /** Sends the joined lines; resolves true when the message was accepted. */
  flush: (content: string) => Promise<boolean>;
  /** The user is hesitating; called at most once per stretch of talk. */
  onNudge?: (reason: ListenNudgeReason) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [lastActivity, setLastActivity] = useState(0);
  // After a refused send, wait for the user to say something again.
  const [held, setHeld] = useState(false);
  const flushing = useRef(false);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const nudgeRef = useRef(onNudge);
  nudgeRef.current = onNudge;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const keyRef = useRef(conversationKey);
  keyRef.current = conversationKey;

  // One nudge per stretch of talk; a sent line starts a new stretch.
  const nudged = useRef(false);
  const erase = useRef({ previous: 0, run: 0, counted: false, count: 0 });
  const newStretch = useCallback(() => {
    nudged.current = false;
    erase.current = { previous: 0, run: 0, counted: false, count: 0 };
  }, []);
  const nudge = useCallback((reason: ListenNudgeReason) => {
    if (nudged.current || busyRef.current || !keyRef.current) return;
    nudged.current = true;
    nudgeRef.current?.(reason);
  }, []);

  const previousKey = useRef(conversationKey);
  useEffect(() => {
    const previous = previousKey.current;
    previousKey.current = conversationKey;
    // A brand-new conversation getting its id keeps the lines.
    if (previous === null || previous === conversationKey) return;
    setLines([]);
    setHeld(false);
    newStretch();
  }, [conversationKey, newStretch]);

  // Typing counts as still talking; watch it for hesitation.
  useEffect(() => {
    if (!enabled) return;
    const state = erase.current;
    const length = draft.length;
    if (length < state.previous) {
      state.run += state.previous - length;
      if (!state.counted && state.run >= ERASE_CHARS) {
        state.counted = true;
        state.count += 1;
      }
    } else if (length > state.previous) {
      state.run = 0;
      state.counted = false;
    }
    state.previous = length;
    setLastActivity(Date.now());
    if (state.count >= LISTEN_REWRITES) nudge("rewriting");
    if (!draft.trim()) return;
    const timer = setTimeout(() => nudge("stalled"), LISTEN_STALL_MS);
    return () => clearTimeout(timer);
  }, [enabled, draft, nudge]);

  const push = useCallback(
    (line: string) => {
      const text = line.trim();
      if (!text) return;
      setLines((value) => [...value, text]);
      setLastActivity(Date.now());
      setHeld(false);
      newStretch();
    },
    [newStretch],
  );

  // Something in the box means the user is still talking: never send then.
  const composing = enabled && Boolean(draft.trim());
  useEffect(() => {
    if (busy || held || composing || !lines.length || flushing.current) return;
    // Leaving 倾听 sends whatever is still waiting right away.
    const wait = enabled
      ? Math.max(0, lastActivity + LISTEN_IDLE_MS - Date.now())
      : 0;
    const timer = setTimeout(() => {
      const batch = lines;
      flushing.current = true;
      // The batch shows as the sent message from here on; lines said while
      // it is in flight queue up behind it. A refused send puts it back.
      setLines((value) => value.slice(batch.length));
      const key = keyRef.current;
      const restore = () => {
        // A new conversation started from the queue keeps no stale lines.
        if (key !== null && keyRef.current !== key) return;
        setLines((value) => [...batch, ...value]);
        setHeld(true);
      };
      void flushRef
        .current(batch.join("\n"))
        .then((sent) => {
          if (!sent) restore();
        })
        .catch(restore)
        .finally(() => {
          flushing.current = false;
          setLastActivity(Date.now());
        });
    }, wait);
    return () => clearTimeout(timer);
  }, [enabled, busy, held, composing, lines, lastActivity]);

  const talking = enabled && Boolean(lines.length || draft.trim());
  return { lines, push, talking };
}
