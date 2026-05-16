import { create } from "zustand";

import type {
  WorkbenchGeneration,
  WorkbenchTaskStatus,
} from "@/components/workbench/types";

interface GenerationStoreState {
  status: WorkbenchTaskStatus;
  progress: number;
  queueNotice: string | null;
  history: WorkbenchGeneration[];
  activeGeneration: WorkbenchGeneration | null;
  setStatus: (status: WorkbenchTaskStatus) => void;
  setProgress: (progress: number) => void;
  setQueueNotice: (
    next: string | null | ((current: string | null) => string | null),
  ) => void;
  setHistory: (
    next:
      | WorkbenchGeneration[]
      | ((current: WorkbenchGeneration[]) => WorkbenchGeneration[]),
  ) => void;
  setActiveGeneration: (next: WorkbenchGeneration | null) => void;
  selectGeneration: (next: WorkbenchGeneration) => void;
  mergeGeneration: (next: WorkbenchGeneration) => void;
  resetTask: () => void;
}

export const useGenerationStore = create<GenerationStoreState>((set) => ({
  status: "idle",
  progress: 0,
  queueNotice: null,
  history: [],
  activeGeneration: null,
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setQueueNotice: (next) =>
    set((current) => ({
      queueNotice:
        typeof next === "function" ? next(current.queueNotice) : next,
    })),
  setHistory: (next) =>
    set((current) => ({
      history: typeof next === "function" ? next(current.history) : next,
    })),
  setActiveGeneration: (activeGeneration) => set({ activeGeneration }),
  selectGeneration: (activeGeneration) => set({ activeGeneration }),
  mergeGeneration: (next) =>
    set((current) => ({
      activeGeneration: next,
      history: [next, ...current.history.filter((item) => item.id !== next.id)],
    })),
  resetTask: () =>
    set({
      status: "idle",
      progress: 0,
      queueNotice: null,
      activeGeneration: null,
    }),
}));
