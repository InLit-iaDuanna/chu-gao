import type { WorkbenchGeneration } from "@/components/workbench/types";

export const ALLOWED_REFERENCE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function selectedActiveImage(
  generation: WorkbenchGeneration | null,
  imageId: string | null,
): WorkbenchGeneration["images"][number] | null {
  if (!generation) {
    return null;
  }

  return (
    generation.images.find((image) => image.id && image.id === imageId) ??
    generation.images.at(-1) ??
    null
  );
}

export function currentWorkbenchPath(): "/app" | "/app/canvas" {
  if (typeof window === "undefined") return "/app";

  return window.location.pathname.startsWith("/app/canvas")
    ? "/app/canvas"
    : "/app";
}

export function currentWorkbenchConversationUrl(
  conversationId: string,
): string {
  return `${currentWorkbenchPath()}?conversation=${encodeURIComponent(conversationId)}`;
}
