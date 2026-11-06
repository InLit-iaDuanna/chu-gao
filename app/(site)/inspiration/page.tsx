import type { Metadata } from "next";
import { Suspense } from "react";

import { InspirationFeed } from "@/components/inspiration/InspirationFeed";

export const metadata: Metadata = {
  title: "灵感圈 · Chūgǎo",
  description: "跨学科的设计灵感交流社区。讨论作品、过程、模式与设计问题。",
};

export default function InspirationPage() {
  return (
    <Suspense fallback={<div className="mx-auto min-h-screen max-w-7xl px-6 py-16 text-sm text-text-muted">正在读取灵感…</div>}>
      <InspirationFeed />
    </Suspense>
  );
}
