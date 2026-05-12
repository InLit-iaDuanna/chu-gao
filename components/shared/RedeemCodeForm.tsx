"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RedeemCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = code.trim().length > 0 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("兑换中...");

    try {
      const response = await fetch("/api/me/redeem-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { credits: number; balance: number };
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        setMessage(payload?.error?.message ?? "兑换失败");
        return;
      }

      setCode("");
      setMessage(
        `已兑换 ${payload?.data?.credits ?? 0} 点，当前余额 ${payload?.data?.balance ?? 0} 点`,
      );
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-[6px] border border-border p-4">
      <p className="text-sm font-medium">兑换点数码</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="输入兑换码"
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          兑换
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}
