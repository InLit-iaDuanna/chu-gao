import { create } from "zustand";

import type { UploadedReferenceImage } from "@/components/workbench/types";

interface ReferenceImageStoreState {
  uploadedReferenceImages: UploadedReferenceImage[];
  isUploadingReference: boolean;
  useCurrentImageAsReference: boolean;
  setIsUploadingReference: (value: boolean) => void;
  setUseCurrentImageAsReference: (value: boolean) => void;
  addReferenceImage: (image: UploadedReferenceImage) => void;
  removeReferenceImage: (key: string) => void;
  clearReferenceImages: () => void;
}

export const useReferenceImageStore = create<ReferenceImageStoreState>(
  (set) => ({
    uploadedReferenceImages: [],
    isUploadingReference: false,
    useCurrentImageAsReference: false,
    setIsUploadingReference: (value) => set({ isUploadingReference: value }),
    setUseCurrentImageAsReference: (value) =>
      set({ useCurrentImageAsReference: value }),
    addReferenceImage: (image) =>
      set((current) => ({
        uploadedReferenceImages: [...current.uploadedReferenceImages, image],
      })),
    removeReferenceImage: (key) =>
      set((current) => {
        const image = current.uploadedReferenceImages.find(
          (item) => item.key === key,
        );
        if (image) {
          URL.revokeObjectURL(image.previewUrl);
        }
        return {
          uploadedReferenceImages: current.uploadedReferenceImages.filter(
            (item) => item.key !== key,
          ),
        };
      }),
    clearReferenceImages: () =>
      set((current) => {
        for (const image of current.uploadedReferenceImages) {
          URL.revokeObjectURL(image.previewUrl);
        }
        return { uploadedReferenceImages: [] };
      }),
  }),
);
