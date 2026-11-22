"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long the user must stay quiet (no new line, no typing) before the
 * lines said so far go to the model together.
 */
export const LISTEN_IDLE_MS = 2_500;

/**
 * 倾听 as a full-duplex conversation: the user keeps talking line after line
 * without waiting for the assistant. Lines pile up here and are sent as one
 * message once the user pauses and no reply is in flight, so a burst of
 * short lines costs one model call instead of one per line.
 */
export function useListenQueue({
  enabled,
  busy,
  draft,
  conversationKey,
  flush,
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
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [lastActivity, setLastActivity] = useState(0);
  // After a refused send, wait for the user to say something again.
  const [held, setHeld] = useState(false);
  const flushing = useRef(false);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const keyRef = useRef(conversationKey);
  keyRef.current = conversationKey;

  const previousKey = useRef(conversationKey);
  useEffect(() => {
    const previous = previousKey.current;
    previousKey.current = conversationKey;
    // A brand-new conversation getting its id keeps the lines.
    if (previous === null || previous === conversationKey) return;
    setLines([]);
    setHeld(false);
  }, [conversationKey]);

  // Typing counts as still talking.
  useEffect(() => {
    if (enabled && draft) setLastActivity(Date.now());
  }, [enabled, draft]);

  const push = useCallback((line: string) => {
    const text = line.trim();
    if (!text) return;
    setLines((value) => [...value, text]);
    setLastActivity(Date.now());
    setHeld(false);
  }, []);

  useEffect(() => {
    if (busy || held || !lines.length || flushing.current) return;
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
  }, [enabled, busy, held, lines, lastActivity]);

  const talking = enabled && Boolean(lines.length || draft.trim());
  return { lines, push, talking };
}
