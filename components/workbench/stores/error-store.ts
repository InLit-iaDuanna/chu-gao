import { create } from "zustand";

export type ErrorScope =
  | "models"
  | "account"
  | "history"
  | "conversation"
  | "generation"
  | "reference";

export interface WorkbenchError {
  scope: ErrorScope;
  message: string;
}

interface ErrorState {
  errors: Partial<Record<ErrorScope, string>>;
  setError: (scope: ErrorScope, message: string | null) => void;
  clearAll: () => void;
  clearScopes: (scopes: ErrorScope[]) => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  errors: {},
  setError: (scope, message) =>
    set((current) => {
      const next = { ...current.errors };
      if (message) {
        next[scope] = message;
      } else {
        delete next[scope];
      }
      return { errors: next };
    }),
  clearAll: () => set({ errors: {} }),
  clearScopes: (scopes) =>
    set((current) => {
      const next = { ...current.errors };
      for (const scope of scopes) {
        delete next[scope];
      }
      return { errors: next };
    }),
}));

export function selectAggregatedErrorMessage(
  errors: Partial<Record<ErrorScope, string>>,
  scopes?: ErrorScope[],
): string {
  const keys = scopes ?? (Object.keys(errors) as ErrorScope[]);
  return [
    ...new Set(
      keys
        .map((scope) => errors[scope])
        .filter((message): message is string => Boolean(message)),
    ),
  ].join(" ");
}
