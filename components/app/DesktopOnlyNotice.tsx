import Link from "next/link";
import { ArrowLeft, Monitor } from "lucide-react";

import { Button } from "@/components/ui";

/**
 * APP 内的电脑端功能占位页：/app/canvas、/app/nodes、/app/ppt。
 * 服务端根据 UA 判定后渲染，网页端不受影响。
 */
export function DesktopOnlyNotice({
  feature,
}: {
  feature: string;
}): React.ReactElement {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-5 py-12">
      <div className="surface-panel w-full max-w-[360px] px-6 py-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-muted">
          <Monitor aria-hidden="true" size={20} strokeWidth={1.6} />
        </span>
        <h1 className="mt-5 text-lg font-semibold tracking-[-0.01em]">
          该功能请在电脑端使用
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          {feature}需要更大的屏幕和鼠标操作。请在电脑浏览器打开 chugao.art
          继续，手机端可以先在工作台里对话生成。
        </p>
        <Button asChild variant="primary" className="mt-6 w-full">
          <Link href="/app">
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />
            返回工作台
          </Link>
        </Button>
      </div>
    </div>
  );
}
