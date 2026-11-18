"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

import type { ApiDocsModel } from "@/lib/api-docs-shared";
import { Button, Skeleton } from "@/components/ui";

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
    <section
      aria-label="API 接入文档"
      className="mt-6 min-w-0 border-t border-border pt-4"
    >
      <Button
        variant="ghost"
        type="button"
        aria-expanded={open}
        aria-controls="api-docs-body"
        onClick={() => setOpen((v) => !v)}
        className="h-9 w-full justify-between px-2"
      >
        <span>API 接入文档</span>
        {open ? (
          <ChevronUp size={15} className="text-text-muted" />
        ) : (
          <ChevronDown size={15} className="text-text-muted" />
        )}
      </Button>

      {open && (
        <div id="api-docs-body" className="min-w-0 pt-5">
          {failed ? (
            <p role="alert" className="text-sm text-danger">
              文档加载失败，请稍后刷新重试。
            </p>
          ) : docs ? (
            <ApiDocsContent markdown={docs.markdown} models={docs.models} />
          ) : (
            <div className="space-y-3" role="status" aria-label="正在加载文档">
              <Skeleton className="h-5 w-48 max-w-full rounded-md" />
              <Skeleton className="h-24 rounded-md" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
