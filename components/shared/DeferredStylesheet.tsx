"use client";

import { useEffect } from "react";

interface DeferredStylesheetProps {
  /** Absolute URL of a non-critical stylesheet to load after first paint. */
  href: string;
}

/**
 * Injects a stylesheet link after mount so a large, optional font/CSS file never
 * blocks first paint. Used for the CJK serif (LXGW WenKai), which previously shipped
 * as a render-blocking @import of a multi-MB file from an uncontrolled CDN.
 */
export function DeferredStylesheet({ href }: DeferredStylesheetProps): null {
  useEffect(() => {
    if (document.querySelector(`link[data-deferred="${href}"]`)) {
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-deferred", href);
    document.head.appendChild(link);
  }, [href]);

  return null;
}
