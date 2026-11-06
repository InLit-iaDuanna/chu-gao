import { Suspense } from "react";

import { PublishComposer } from "@/components/inspiration/PublishComposer";
import { StudioPageShell } from "@/components/studio/StudioPageShell";

export default function PublishPage() {
  return (
    <StudioPageShell eyebrow="Inspiration Circle" title="发布灵感" wide>
      <Suspense fallback={<div className="surface-panel min-h-72 p-6 text-sm text-text-muted">正在准备发布器…</div>}>
        <PublishComposer />
      </Suspense>
    </StudioPageShell>
  );
}
