import Image from "next/image";
import { Download } from "lucide-react";

import type { WorkbenchTaskStatus } from "@/components/workbench/types";

function timestampForFilename(date = new Date()): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];

  return parts.map((part) => String(part).padStart(2, "0")).join("");
}

function extensionFromUrl(url: string): string {
  const pathname = url.split("?")[0] ?? "";
  const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") {
    return "jpg";
  }

  if (extension === "webp") {
    return "webp";
  }

  return "png";
}

export function Canvas({
  imageUrl,
  status,
  error,
}: {
  imageUrl?: string;
  status: WorkbenchTaskStatus;
  error?: string | null;
  onUseExample?: (prompt: string) => void;
}) {
  const frameClass =
    "surface-panel canvas-panel flex min-h-[420px] items-center justify-center p-6 lg:min-h-0";

  if (!imageUrl) {
    if (status === "pending" || status === "running") {
      const statusLabel = status === "pending" ? "排队中" : "生成中";

      return (
        <div className={frameClass}>
          <div className="max-w-sm text-center">
            <p className="eyebrow">{statusLabel}</p>
            <h3 className="mt-2 text-xl font-medium">正在处理画面</h3>
            <p className="mt-3 break-words text-sm leading-6 text-text-muted">
              任务已经提交到队列，完成后会自动刷新结果。
            </p>
          </div>
        </div>
      );
    }

    if (status === "failed") {
      return (
        <div className={frameClass}>
          <div className="max-w-sm text-center">
            <p className="eyebrow text-danger">失败</p>
            <h3 className="mt-2 text-xl font-medium">任务没有完成</h3>
            <p className="mt-3 break-words text-sm leading-6 text-text-muted">
              {error ??
                "生成没有完成。你可以调整描述、降低张数或稍后重新发送。"}
            </p>
          </div>
        </div>
      );
    }

    if (status === "canceled") {
      return (
        <div className={frameClass}>
          <div className="max-w-sm text-center">
            <p className="eyebrow">已取消</p>
            <h3 className="mt-2 text-xl font-medium">任务已取消</h3>
            <p className="mt-3 break-words text-sm leading-6 text-text-muted">
              如果任务还未开始，点数会退回到账户余额。
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className={frameClass}>
        <div className="max-w-md text-center">
          <p className="eyebrow">画布</p>
          <h3 className="mt-2 text-xl font-medium">
            结果会出现在这里
          </h3>
          <p className="mt-3 break-words text-sm leading-6 text-text-muted">
            可以直接写目标图，也可以像对话一样补充用途、风格、构图、参考约束和需要避开的内容。生成后继续发送消息即可迭代同一张图。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-panel canvas-panel img-enter relative min-h-[420px] overflow-hidden p-3 lg:min-h-0">
      <div className="absolute left-4 top-4 max-w-[calc(100%-2rem)] truncate rounded-full bg-black/55 px-3 py-1 text-xs text-white">
        {status === "running"
          ? "生成中"
          : status === "failed"
            ? "失败"
            : status === "canceled"
              ? "已取消"
              : "已完成"}
      </div>
      <a
        href={imageUrl}
        download={`chugao-${timestampForFilename()}.${extensionFromUrl(imageUrl)}`}
        className="tool-button absolute right-4 top-4 z-10 h-9 bg-black/55 text-white hover:bg-black/70"
      >
        <Download className="h-4 w-4 stroke-[1.5]" />
        下载
      </a>
      <div className="relative flex h-full min-h-[390px] items-center justify-center overflow-hidden rounded-[8px] bg-background">
        <Image
          src={imageUrl}
          alt="生成结果"
          fill
          className="object-contain"
          sizes="(min-width: 1280px) 50vw, 100vw"
          priority
        />
      </div>
    </div>
  );
}
