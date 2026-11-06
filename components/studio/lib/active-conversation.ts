export const ACTIVE_CONVERSATION_STORAGE_KEY = "chugao.active-conversation";

export function readActiveConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
}

export function writeActiveConversationId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, id);
  } else {
    window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
  }
}

export function activeConversationHref(id: string | null): string {
  return id ? `/app?thread=${encodeURIComponent(id)}` : "/app";
}
