import { headers } from "next/headers";

import { DesktopOnlyNotice } from "@/components/app/DesktopOnlyNotice";
import { NodesApp } from "@/components/studio/nodes/NodesApp";
import { isAppRequestHeaders } from "@/lib/app-ua";

export default async function NodesPage() {
  // UA 只用于界面分支：APP 里节点画布暂只支持电脑端。
  if (isAppRequestHeaders(await headers())) {
    return <DesktopOnlyNotice feature="节点画布" />;
  }

  return <NodesApp />;
}
