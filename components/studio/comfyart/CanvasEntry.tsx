"use client";

import dynamic from "next/dynamic";
import { LoaderCircle } from "lucide-react";

const ComfyArtCanvas = dynamic(() => import("./ComfyArtCanvas"), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      className="flex h-full items-center justify-center gap-2 text-sm text-text-muted"
    >
      <LoaderCircle size={16} className="animate-spin" /> 正在打开画布
    </div>
  ),
});

const Preview = dynamic(
  () => import("./ComfyArtCanvas").then((module) => module.ComfyArtPreview),
  { ssr: false },
);

export function CanvasPreviewEntry() {
  return <Preview />;
}

export function CanvasEntry({ licenseKey }: { licenseKey?: string }) {
  return <ComfyArtCanvas licenseKey={licenseKey} />;
}
