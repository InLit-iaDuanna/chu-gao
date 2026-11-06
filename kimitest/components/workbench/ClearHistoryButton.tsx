"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { friendlyErrorMessage } from "@/components/shared/error-copy";

type ClearHistoryResponse =
  | {
      ok: true;
      data: {
        conversations: number;
        generations: number;
      };
    }
  | {
      ok: false;
      error: {
        code?: string;
        message?: string;
      };
    };

export function ClearHistoryButton({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearHistory() {
    if (isClearing || disabled) {
      return;
    }

    const confirmed = window.confirm(
      "确定清除当前账户的对话与生成记录吗？这个操作会从历史页隐藏这些记录。",
    );

    if (!confirmed) {
      return;
    }

    setIsClearing(true);
    setError(null);

    try {
      const response = await fetch("/api/history", {
        method: "DELETE",
      });
      const payload = (await response.json()) as ClearHistoryResponse;

      if (!payload.ok) {
        throw new Error(
          friendlyErrorMessage(payload.error, "历史记录清除失败。"),
        );
      }

      router.refresh();
    } catch (clearError) {
      setError(
        friendlyErrorMessage(
          clearError instanceof Error ? clearError.message : null,
          "历史记录清除失败。",
        ),
      );
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2 max-sm:items-stretch">
      <button
        type="button"
        className="tool-button h-9 text-danger disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled || isClearing}
        onClick={clearHistory}
      >
        <Trash2 className="h-4 w-4 stroke-[1.5]" />
        {isClearing ? "清除中" : "清除历史"}
      </button>
      {error ? (
        <p className="max-w-xs text-right text-xs leading-5 text-danger max-sm:text-left">
          {error}
        </p>
      ) : null}
    </div>
  );
}
