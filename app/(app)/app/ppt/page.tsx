import { headers } from "next/headers";

import { DesktopOnlyNotice } from "@/components/app/DesktopOnlyNotice";
import { PptStudio } from "@/components/studio/ppt/PptStudio";
import { isAppRequestHeaders } from "@/lib/app-ua";

export default async function PptPage() {
  // UA 只用于界面分支：APP 里 PPT 暂只支持电脑端。
  if (isAppRequestHeaders(await headers())) {
    return <DesktopOnlyNotice feature="PPT 生成" />;
  }

  return <PptStudio />;
}
