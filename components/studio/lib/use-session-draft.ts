"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { REASONING_EFFORTS } from "@/lib/chat-model-options";

export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);

export const referencesSchema = z
  .array(
    z.object({
      kind: z.enum(["upload", "source"]),
      key: z.string().min(1),
      previewUrl: z
        .string()
        .refine(
          (url) =>
            url.startsWith("/api/upload?") ||
            url.startsWith("/api/generations/"),
        ),
    }),
  )
  .max(16);

export const studioDraftSchema = z.object({
  mode: z.enum(["image", "chat", "agent"]).optional(),
  prompt: z.string().max(4000),
  activeQuestion: z.string().max(200).nullable().optional(),
  modelId: z.string().nullable(),
  chatModelId: z.string().min(1).nullable().optional().catch(undefined),
  chatReasoningEffort: reasoningEffortSchema.optional().catch(undefined),
  params: z.object({
    n: z.number().int().min(1).max(4),
    size: z.string().optional(),
    negativePrompt: z.string().optional(),
    seed: z.number().optional(),
    outputFormat: z.string().optional(),
    referenceImages: referencesSchema,
  }),
});

export const conversationDraftSchema = z.object({
  draft: z.string().max(4000),
  references: referencesSchema,
});

export const agentTurnsSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
    }),
  )
  .max(80);

export function useSessionDraft<T>(
  key: string | null,
  value: T,
  schema: z.ZodType<T>,
  onRestore: (draft: T | null) => void,
  skipRestore = false,
) {
  const [hydrated, setHydrated] = useState<string | null>(null);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  useEffect(() => {
    if (!key) return;
    if (!skipRestore) {
      let saved: T | null = null;
      try {
        const raw = sessionStorage.getItem(key);
        const parsed = schema.safeParse(raw ? JSON.parse(raw) : null);
        if (parsed.success) saved = parsed.data;
      } catch {
        /* Private browsing and invalid drafts fall back to empty state. */
      }
      restoreRef.current(saved);
    }
    setHydrated(key);
  }, [key, schema, skipRestore]);
  useEffect(() => {
    if (!key || hydrated !== key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Keep the in-memory draft. */
    }
  }, [hydrated, key, value]);
}
