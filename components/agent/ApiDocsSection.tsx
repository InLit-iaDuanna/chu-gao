"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

import type { ApiDocsModel } from "@/lib/api-docs-shared";

import { ApiDocsContent } from "./ApiDocsContent";

type DocsPayload = { markdown: string; models: ApiDocsModel[] };

export function ApiDocsSection() {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocsPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || docs) return;
    const controller = new AbortController();
    fetch("/api/public/api-docs", { signal: controller.signal })
      .then((res) => res.json())
      .then((body: { ok: boolean; data?: DocsPayload }) => {
        if (!body.ok || !body.data) throw new Error("bad response");
        setDocs(body.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [open, docs]);

  return (
    <div className="mt-6 rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="api-docs-body"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-foreground/[0.03]"
      >
        <span>API 接入文档</span>
        {open ? (
          <ChevronUp size={15} className="text-text-muted" />
        ) : (
          <ChevronDown size={15} className="text-text-muted" />
        )}
      </button>

      {open && (
        <div id="api-docs-body" className="border-t border-border px-4 pb-6 pt-5">
          {failed ? (
            <p role="alert" className="text-sm text-danger">
              文档加载失败，请稍后刷新重试。
            </p>
          ) : docs ? (
            <ApiDocsContent markdown={docs.markdown} models={docs.models} />
          ) : (
            <div className="space-y-3" role="status" aria-label="正在加载文档">
              <div className="h-5 w-48 animate-pulse rounded bg-foreground/[0.06]" />
              <div className="h-24 animate-pulse rounded bg-foreground/[0.04]" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
