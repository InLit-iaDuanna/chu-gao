import { z } from "zod";

export const MAX_CHAT_REFERENCES = 8;
const label = z.string().trim().min(1).max(128).optional();

export const chatReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("upload"),
      key: z.string().min(1).max(512),
      label,
    })
    .strict(),
  z
    .object({
      kind: z.literal("generated"),
      id: z.string().min(1).max(128),
      label,
    })
    .strict(),
]);
export const chatReferencesSchema = z
  .array(chatReferenceSchema)
  .max(MAX_CHAT_REFERENCES);
export type ChatReference = z.infer<typeof chatReferenceSchema>;

export interface ChatReferencesInput {
  references?: readonly ChatReference[];
  referenceImageKeys?: readonly string[];
  sourceImageIds?: readonly string[];
}

/** An explicit ordered list, including [], takes precedence over legacy arrays. */
export function normalizeChatReferences(
  input: ChatReferencesInput,
): ChatReference[] {
  if (input.references !== undefined)
    return chatReferencesSchema.parse(input.references);
  return chatReferencesSchema.parse([
    ...[...new Set(input.referenceImageKeys ?? [])].map((key) => ({
      kind: "upload",
      key,
    })),
    ...[...new Set(input.sourceImageIds ?? [])].map((id) => ({
      kind: "generated",
      id,
    })),
  ]);
}

/** Accepts both the canonical stored array and { references }, plus legacy objects. */
export function storedChatReferences(value: unknown): ChatReference[] {
  if (value == null) return [];
  if (Array.isArray(value)) return chatReferencesSchema.parse(value);
  if (typeof value !== "object") throw new Error("INVALID_CHAT_REFERENCES");
  return normalizeChatReferences(value as ChatReferencesInput);
}
