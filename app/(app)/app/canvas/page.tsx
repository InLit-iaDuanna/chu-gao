import { NodesApp } from "@/components/studio/nodes/NodesApp";
import { CanvasEntry } from "@/components/studio/comfyart/CanvasEntry";
import "tldraw/tldraw.css";
import "@/components/studio/comfyart/canvas.css";

export const dynamic = "force-dynamic";

export default function CanvasPage() {
  const licenseKey =
    process.env.TLDRAW_LICENSE_KEY ||
    process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;
  if (process.env.NODE_ENV === "production" && !licenseKey) return <NodesApp />;
  return <CanvasEntry licenseKey={licenseKey} />;
}
