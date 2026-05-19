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
  activeImageId: string | null;
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
  setActiveImageId: (next: string | null) => void;
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
  activeImageId: null,
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
  setActiveGeneration: (activeGeneration) =>
    set({
      activeGeneration,
      activeImageId: activeGeneration?.images.at(-1)?.id ?? null,
    }),
  setActiveImageId: (activeImageId) => set({ activeImageId }),
  selectGeneration: (activeGeneration) =>
    set({
      activeGeneration,
      activeImageId: activeGeneration.images.at(-1)?.id ?? null,
    }),
  mergeGeneration: (next) =>
    set((current) => {
      const currentImageStillExists = next.images.some(
        (image) => image.id && image.id === current.activeImageId,
      );

      return {
        activeGeneration: next,
        activeImageId: currentImageStillExists
          ? current.activeImageId
          : (next.images.at(-1)?.id ?? null),
        history: [
          next,
          ...current.history.filter((item) => item.id !== next.id),
        ],
      };
    }),
  resetTask: () =>
    set({
      status: "idle",
      progress: 0,
      queueNotice: null,
      activeGeneration: null,
      activeImageId: null,
    }),
}));
