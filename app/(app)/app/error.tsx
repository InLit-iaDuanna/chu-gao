"use client";

import { TriangleAlert } from "lucide-react";

import { Button, EmptyState } from "@/components/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={TriangleAlert}
        title="页面出错了"
        description={
          error.digest
            ? `加载时发生异常（${error.digest}），可以重试或稍后再来。`
            : "加载时发生异常，可以重试或稍后再来。"
        }
        action={
          <Button variant="secondary" onClick={reset}>
            重试
          </Button>
        }
      />
    </div>
  );
}
