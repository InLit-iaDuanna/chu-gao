import type { Metadata } from "next";

import { LegalArticle } from "@/components/legal/LegalArticle";
import {
  TERMS_MD,
  TERMS_UPDATED_AT,
  TERMS_VERSION,
} from "@/lib/legal/terms-content";

export const metadata: Metadata = {
  title: "用户协议 · Chūgǎo Studio",
  description:
    "初稿 Chūgǎo Studio 用户协议：服务内容、积分与充值、行为规范、知识产权与免责。",
};

export default function TermsPage() {
  return (
    <LegalArticle
      title="初稿 Chūgǎo Studio 用户协议"
      version={TERMS_VERSION}
      updatedAt={TERMS_UPDATED_AT}
      markdown={TERMS_MD}
    />
  );
}
