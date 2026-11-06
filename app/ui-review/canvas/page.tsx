import { notFound } from "next/navigation";
import { CanvasPreviewEntry } from "@/components/studio/comfyart/CanvasEntry";
import "tldraw/tldraw.css";
import "@/components/studio/comfyart/canvas.css";

export default function CanvasPreviewPage() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.CANVAS_PREVIEW_ENABLED !== "1"
  )
    notFound();
  return (
    <main className="studio-workspace h-dvh">
      <CanvasPreviewEntry />
    </main>
  );
}
