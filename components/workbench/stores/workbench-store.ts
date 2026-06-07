import { create } from "zustand";

import type { PublicModelDefinition } from "@/lib/models/types";

import type { WorkbenchState } from "@/components/workbench/types";

interface WorkbenchStoreState {
  models: PublicModelDefinition[];
  state: WorkbenchState | null;
  credits: number;
  accountId: string | null;
  isBooting: boolean;
  setModels: (models: PublicModelDefinition[]) => void;
  setState: (
    next:
      | WorkbenchState
      | null
      | ((current: WorkbenchState | null) => WorkbenchState | null),
  ) => void;
  setCredits: (credits: number | ((current: number) => number)) => void;
  setAccountId: (id: string | null) => void;
  setIsBooting: (isBooting: boolean) => void;
  reset: () => void;
}

export const useWorkbenchStore = create<WorkbenchStoreState>((set) => ({
  models: [],
  state: null,
  credits: 0,
  accountId: null,
  isBooting: true,
  setModels: (models) => set({ models }),
  setState: (next) =>
    set((current) => ({
      state: typeof next === "function" ? next(current.state) : next,
    })),
  setCredits: (credits) =>
    set((current) => ({
      credits:
        typeof credits === "function" ? credits(current.credits) : credits,
    })),
  setAccountId: (accountId) => set({ accountId }),
  setIsBooting: (isBooting) => set({ isBooting }),
  reset: () => set({ models: [], state: null, credits: 0, accountId: null }),
}));
