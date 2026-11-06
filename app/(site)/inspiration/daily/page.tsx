import type { Metadata } from "next";

import { DailyPromptPage } from "@/components/inspiration/DailyPromptPage";

export const metadata: Metadata = { title: "每日命题 · 灵感圈", description: "每天一个跨学科设计命题，邀请设计师共同回应。" };

export default function DailyPage() {
  return <DailyPromptPage />;
}
