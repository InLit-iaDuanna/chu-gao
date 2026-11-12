"use client";

import createDOMPurify from "dompurify";
import { isRecord, parseModelCallContent } from "@/lib/model-call-content";

export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function isEmbeddedRasterImage(value: string): boolean {
  return /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(
    value,
  );
}

export function buildHtmlPreviewDocument(source: string): string {
  // Parse inside a detached template before sanitizing so resource URLs never enter the live page.
  const owner = document.createElement("template").content.ownerDocument;
  const root = owner.createElement("html");
  root.innerHTML = source;
  const purify = createDOMPurify(window);
  if (!purify.isSupported) throw new Error("HTML sanitization is unavailable");
  purify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "src") {
      data.keepAttr =
        node.nodeName.toLowerCase() === "img" &&
        node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
        isEmbeddedRasterImage(data.attrValue);
    }
  });
  purify.sanitize(root, {
    IN_PLACE: true,
    WHOLE_DOCUMENT: true,
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: [
      "base",
      "link",
      "meta",
      "template",
      "form",
      "audio",
      "video",
      "source",
      "track",
      "animate",
      "set",
    ],
    FORBID_ATTR: [
      "href",
      "xlink:href",
      "srcset",
      "action",
      "formaction",
      "target",
      "ping",
      "background",
      "poster",
      "autofocus",
    ],
    ALLOW_DATA_ATTR: false,
  });
  const head = root.querySelector("head") ?? owner.createElement("head");
  if (!head.parentNode) root.prepend(head);
  const charset = owner.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const policy = owner.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", HTML_PREVIEW_CSP);
  const viewport = owner.createElement("meta");
  viewport.setAttribute("name", "viewport");
  viewport.setAttribute("content", "width=device-width, initial-scale=1");
  const referrer = owner.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  const defaults = owner.createElement("style");
  defaults.textContent =
    "html{color-scheme:light;background:#fff;min-height:100%}body{min-height:100%;margin:0;padding:24px;font-family:system-ui,sans-serif;line-height:1.6;overflow-wrap:anywhere}*,*::before,*::after{box-sizing:border-box}img,svg{max-width:100%;height:auto}pre{max-width:100%;overflow:auto}table{max-width:100%;border-collapse:collapse}";
  head.prepend(charset, policy, viewport, referrer, defaults);
  return "<!doctype html>\n" + root.outerHTML;
}

export function htmlPreviewSource(value: string): string | null {
  const inspect = (candidate: unknown, depth: number): string | null => {
    if (depth > 6) return null;
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        const source = inspect(entry, depth + 1);
        if (source) return source;
      }
      return null;
    }
    if (isRecord(candidate)) {
      for (const key of [
        "html",
        "text",
        "output_text",
        "content",
        "choices",
        "message",
        "output",
        "response",
        "body",
      ]) {
        const source = inspect(candidate[key], depth + 1);
        if (source) return source;
      }
      return null;
    }
    if (typeof candidate !== "string") return null;
    const trimmed = candidate.trim();
    // Unwrap protocol envelopes before looking for markup in message bodies.
    if (/^[{\["]/.test(trimmed)) {
      const parsed = parseModelCallContent(trimmed);
      return parsed.kind === "json" ? inspect(parsed.value, depth + 1) : null;
    }
    const fenced = trimmed.match(
      /(?:^|\n)[ \t]*```(?:html|xml|svg)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?:\s|$)/i,
    );
    if (fenced) return inspect(fenced[1], depth + 1);
    if (
      /^(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html\b|<(?:html|body|main|section|article|div|svg|h[1-6])(?:\s|>))/i.test(
        trimmed,
      )
    )
      return trimmed;
    return null;
  };
  return inspect(value, 0);
}
