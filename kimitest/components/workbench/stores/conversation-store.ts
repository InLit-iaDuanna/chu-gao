import { create } from "zustand";

import type {
  ConversationMessage,
  ConversationSummaryView,
} from "@/lib/conversation";

import { WELCOME_MESSAGE } from "@/components/workbench/lib/messages";

interface ConversationStoreState {
  conversationId: string | null;
  conversationTitle: string;
  messages: ConversationMessage[];
  conversations: ConversationSummaryView[];
  setConversationId: (id: string | null) => void;
  setConversationTitle: (title: string) => void;
  setMessages: (
    next:
      | ConversationMessage[]
      | ((current: ConversationMessage[]) => ConversationMessage[]),
  ) => void;
  appendMessage: (message: ConversationMessage) => void;
  setConversations: (
    next:
      | ConversationSummaryView[]
      | ((current: ConversationSummaryView[]) => ConversationSummaryView[]),
  ) => void;
  resetConversation: () => void;
}

export const useConversationStore = create<ConversationStoreState>((set) => ({
  conversationId: null,
  conversationTitle: "新的创作对话",
  messages: [WELCOME_MESSAGE],
  conversations: [],
  setConversationId: (conversationId) => set({ conversationId }),
  setConversationTitle: (conversationTitle) => set({ conversationTitle }),
  setMessages: (next) =>
    set((current) => ({
      messages: typeof next === "function" ? next(current.messages) : next,
    })),
  appendMessage: (message) =>
    set((current) => ({ messages: [...current.messages, message] })),
  setConversations: (next) =>
    set((current) => ({
      conversations:
        typeof next === "function" ? next(current.conversations) : next,
    })),
  resetConversation: () =>
    set({
      conversationId: null,
      conversationTitle: "新的创作对话",
      messages: [WELCOME_MESSAGE],
    }),
}));
