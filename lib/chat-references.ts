import { db } from "@/lib/db";
import { toVisionImagePart, type VisionImagePart } from "@/lib/creative-vision";
import {
  normalizeUploadedReferenceKey,
  readPrivateStorageKey,
} from "@/lib/storage";
import {
  chatReferencesSchema,
  normalizeChatReferences,
  type ChatReference,
  type ChatReferencesInput,
} from "@/lib/chat-references-types";

export {
  chatReferenceSchema,
  chatReferencesSchema,
  MAX_CHAT_REFERENCES,
  normalizeChatReferences,
  storedChatReferences,
} from "@/lib/chat-references-types";
export type {
  ChatReference,
  ChatReferencesInput,
} from "@/lib/chat-references-types";

export class ChatReferenceError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code:
      | "REFERENCE_NOT_FOUND"
      | "REFERENCE_TOO_LARGE"
      | "INVALID_CHAT_REFERENCES",
  ) {
    super(code);
    this.name = "ChatReferenceError";
  }
}

export async function resolveChatReferences(
  userId: string,
  input: readonly ChatReference[] | ChatReferencesInput | string[],
  sourceIds: string[] = [],
) {
  const list: unknown[] | null = Array.isArray(input) ? input : null;
  let references: ChatReference[];
  try {
    references = list
      ? list.some((item) => typeof item === "string") || sourceIds.length
        ? normalizeChatReferences({
            referenceImageKeys: list.map((item) => {
              if (typeof item !== "string")
                throw new Error("INVALID_CHAT_REFERENCES");
              return item;
            }),
            sourceImageIds: sourceIds,
          })
        : chatReferencesSchema.parse(list)
      : normalizeChatReferences(input as ChatReferencesInput);
  } catch {
    throw new ChatReferenceError("INVALID_CHAT_REFERENCES");
  }
  const keys = references.map((reference) => {
    if (reference.kind !== "upload") return null;
    const normalized = normalizeUploadedReferenceKey(reference.key);
    if (!normalized || !normalized.startsWith(`uploads/${userId}/`))
      throw new ChatReferenceError("REFERENCE_NOT_FOUND");
    return normalized;
  });
  const ids = [
    ...new Set(
      references.flatMap((reference) =>
        reference.kind === "generated" ? [reference.id] : [],
      ),
    ),
  ];
  const generatedKeys = new Map<string, string>();
  if (ids.length) {
    const images = await db.generatedImage.findMany({
      where: { id: { in: ids }, generation: { userId, deletedAt: null } },
      select: { id: true, storageKey: true },
    });
    if (images.length !== ids.length)
      throw new ChatReferenceError("REFERENCE_NOT_FOUND");
    for (const image of images) generatedKeys.set(image.id, image.storageKey);
  }
  // Bound the vision payload independently of the original image size.
  const parts: VisionImagePart[] = [];
  for (const [index, reference] of references.entries()) {
    const key =
      reference.kind === "upload"
        ? keys[index]
        : generatedKeys.get(reference.id);
    if (!key) throw new ChatReferenceError("REFERENCE_NOT_FOUND");
    try {
      const buffer = await readPrivateStorageKey(key);
      parts.push(await toVisionImagePart(buffer));
    } catch (error) {
      throw new ChatReferenceError(
        error instanceof Error && error.message === "REFERENCE_TOO_LARGE"
          ? "REFERENCE_TOO_LARGE"
          : "REFERENCE_NOT_FOUND",
      );
    }
  }
  return parts;
}
