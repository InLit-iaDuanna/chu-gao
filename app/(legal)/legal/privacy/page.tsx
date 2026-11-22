import type { Metadata } from "next";

import { LegalArticle } from "@/components/legal/LegalArticle";
import {
  PRIVACY_MD,
  PRIVACY_UPDATED_AT,
  PRIVACY_VERSION,
} from "@/lib/legal/privacy-content";

export const metadata: Metadata = {
  title: "隐私政策 · Chūgǎo Studio",
  description:
    "初稿 Chūgǎo Studio 隐私政策：收集的信息、Cookie、共享与跨境提供、保存期限与你的权利。",
};

export default function PrivacyPage() {
  return (
    <LegalArticle
      title="初稿 Chūgǎo Studio 隐私政策"
      version={PRIVACY_VERSION}
      updatedAt={PRIVACY_UPDATED_AT}
      markdown={PRIVACY_MD}
    />
  );
}
