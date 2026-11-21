"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getPpt, isApiError } from "./api";
import type { PptGeneration } from "./types";

/**
 * One shared, polled copy of each chat deck, so the outline card in the
 * conversation and the side panel show the same state with one request loop.
 */

interface Entry {
  deck: PptGeneration | null;
  error: string | null;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  loading: boolean;
  /** A refresh was asked for while a request was in flight. */
  again: boolean;
  snapshot: DeckState;
}

export interface DeckState {
  deck: PptGeneration | null;
  error: string | null;
}

const POLL_MS = 3000;
const entries = new Map<string, Entry>();
const EMPTY: DeckState = { deck: null, error: null };

function entryFor(id: string): Entry {
  let entry = entries.get(id);
  if (!entry) {
    entry = {
      deck: null,
      error: null,
      listeners: new Set(),
      timer: null,
      loading: false,
      again: false,
      snapshot: EMPTY,
    };
    entries.set(id, entry);
  }
  return entry;
}

export function deckIsRendering(deck: PptGeneration | null): boolean {
  if (!deck || deck.mode !== "image") return false;
  return (
    deck.status === "generating" ||
    deck.slides.some(
      (slide) => slide.status === "generating" || slide.status === "enhancing",
    )
  );
}

function emit(entry: Entry) {
  entry.snapshot = { deck: entry.deck, error: entry.error };
  for (const listener of entry.listeners) listener();
}

function schedule(id: string, entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  if (!entry.listeners.size || !deckIsRendering(entry.deck)) return;
  entry.timer = setTimeout(() => void loadDeck(id), POLL_MS);
}

export async function loadDeck(id: string): Promise<void> {
  const entry = entryFor(id);
  if (entry.loading) {
    entry.again = true;
    return;
  }
  entry.loading = true;
  try {
    entry.deck = await getPpt(id);
    entry.error = null;
  } catch (error) {
    entry.error = isApiError(error) ? error.message : "演示文稿读取失败";
  } finally {
    entry.loading = false;
  }
  emit(entry);
  if (entry.again) {
    entry.again = false;
    return loadDeck(id);
  }
  schedule(id, entry);
}

/** Apply a local change right away (for example right after a mode was chosen). */
export function patchDeck(id: string, patch: Partial<PptGeneration>) {
  const entry = entryFor(id);
  if (!entry.deck) return;
  entry.deck = { ...entry.deck, ...patch };
  emit(entry);
}

export function useDeck(id: string | null): DeckState & {
  refresh: () => Promise<void>;
} {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!id) return () => undefined;
      const entry = entryFor(id);
      entry.listeners.add(listener);
      if (!entry.deck && !entry.loading) void loadDeck(id);
      else schedule(id, entry);
      return () => {
        entry.listeners.delete(listener);
        if (!entry.listeners.size && entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
      };
    },
    [id],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (id ? entryFor(id).snapshot : EMPTY),
    () => EMPTY,
  );
  const refresh = useCallback(
    () => (id ? loadDeck(id) : Promise.resolve()),
    [id],
  );
  return { ...state, refresh };
}
