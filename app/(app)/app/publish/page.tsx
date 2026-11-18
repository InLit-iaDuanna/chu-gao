import { Suspense } from "react";

import { PublishComposer } from "@/components/inspiration/PublishComposer";

export default function PublishPage() {
  return (
    <div className="h-full min-w-0 overflow-y-auto text-sm tracking-normal">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <header className="app-page-header mb-6 border-b border-border pb-5">
          <h1 className="app-page-title text-xl font-semibold sm:text-2xl">
            发布灵感
          </h1>
        </header>
        <Suspense
          fallback={
            <div
              className="min-h-64 py-6 text-sm text-text-muted"
              role="status"
            >
              正在准备发布器…
            </div>
          }
        >
          <PublishComposer />
        </Suspense>
      </div>
    </div>
  );
}
