"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui";
import {
  CALL_SOURCE_LABELS,
  formatCallTime,
  type AdminModelCall,
} from "@/lib/model-call-types";
import { listAdminModelCalls } from "./lib/api";
import type { AdminGenerationItem } from "./lib/types";
import { ModelCallTable } from "./ModelCallsView";
import { ErrorText } from "./ui";

export function GenerationDetails({
  item,
  onClose,
}: {
  item: AdminGenerationItem;
  onClose: () => void;
}) {
  const [calls, setCalls] = useState<AdminModelCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setCalls(null);
    setError(null);
    listAdminModelCalls({ generationId: item.id }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCalls(result.items);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "调用记录读取失败",
          );
      });
    return () => controller.abort();
  }, [item.id]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-5xl overflow-y-auto p-5 sm:p-6"
      >
        <DialogTitle className="pr-7 text-base font-semibold">
          图片任务详情
        </DialogTitle>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 break-all text-xs sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["任务 ID", item.id],
            ["来源", CALL_SOURCE_LABELS[item.source]],
            ["用户", item.user?.email ?? item.userId],
            ["模型", item.modelId],
            [
              "渠道 / 账号",
              `${item.provider?.name ?? "—"} / ${item.providerAccount?.name ?? item.providerAccountId ?? "—"}`,
            ],
            [
              "尺寸 / 张数",
              `${item.resolution ?? "auto"} · ${item.aspectRatio} · ${item.n} 张`,
            ],
            [
              "开始时间（北京）",
              formatCallTime(item.startedAt ?? item.createdAt),
            ],
            ["完成时间（北京）", formatCallTime(item.finishedAt)],
            ["错误代码", item.errorCode ?? "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-text-faint">{label}</dt>
              <dd className="mt-1 leading-5">{value}</dd>
            </div>
          ))}
        </dl>
        {item.errorMessage && (
          <pre className="mt-4 whitespace-pre-wrap break-all border-t border-border pt-4 text-xs leading-6 text-danger">
            {item.errorMessage}
          </pre>
        )}
        <section className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-medium">提示词</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6">
            {item.prompt}
          </p>
        </section>
        <section className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-medium">结果图（{item.imageCount}）</h3>
          {item.images.length ? (
            <div className="mt-3 flex flex-wrap gap-3">
              {item.images.map((image, index) => (
                <a
                  key={image.id}
                  href={image.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-36 text-xs"
                  title={`查看原图 ${index + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.thumbnailUrl}
                    alt={`结果图 ${index + 1}`}
                    className="h-36 w-36 rounded border border-border bg-surface-2 object-contain"
                  />
                  <p className="mt-1 text-text-muted">
                    {index + 1} · {image.width} × {image.height}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10px] text-text-faint">
                    {image.id}
                  </p>
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-text-muted">
              {item.source === "api" && item.status === "SUCCEEDED"
                ? "API 图片未留存"
                : item.status === "FAILED"
                  ? "任务失败，未生成结果图"
                  : "暂无结果图"}
            </p>
          )}
        </section>
        {!!item.references?.length && (
          <section className="mt-5 border-t border-border pt-4">
            <h3 className="text-sm font-medium">参考图（按提交顺序）</h3>
            <div className="mt-3 flex flex-wrap gap-3">
              {item.references.map((reference) => (
                <div key={reference.index} className="w-28">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={reference.thumbnailUrl}
                    alt={`参考图 ${reference.index + 1}`}
                    className="h-28 w-28 rounded border border-border bg-surface-2 object-contain"
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    参考图 {reference.index + 1}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
        <section className="mt-5 border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium">调用记录</h3>
          <ErrorText message={error} />
          {calls ? (
            <ModelCallTable items={calls} />
          ) : !error ? (
            <p className="text-xs text-text-muted">读取中</p>
          ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}
