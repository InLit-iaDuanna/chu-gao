"use client";

import { Button } from "@/components/ui";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { clearHistory, isApiError } from "./lib/api";

export function ClearHistoryButton({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClear() {
    if (isClearing || disabled) return;

    const confirmed = window.confirm(
      "确定清除当前账户的对话与生成记录吗？这个操作会从历史页隐藏这些记录。",
    );
    if (!confirmed) return;

    setIsClearing(true);
    setError(null);

    try {
      await clearHistory();
      router.refresh();
    } catch (clearError) {
      setError(
        isApiError(clearError) ? clearError.message : "历史记录清除失败",
      );
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-2 tracking-normal">
      <Button
        variant="secondary"
        type="button"
        className="h-11 rounded-md text-sm text-danger sm:h-9"
        disabled={disabled || isClearing}
        onClick={() => void handleClear()}
      >
        <Trash2 className="h-4 w-4 stroke-[1.5]" />
        {isClearing ? "清除中…" : "清除历史"}
      </Button>
      {error ? (
        <p
          role="alert"
          className="text-xs leading-5 text-danger [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
