"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { postJson } from "@/components/admin/admin-form-utils";

export function RedemptionCodeCreateForm() {
  const router = useRouter();
  const [count, setCount] = useState(10);
  const [credits, setCredits] = useState(100);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = count >= 1 && credits >= 1 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("生成中...");

    try {
      await postJson("/api/admin/redemption-codes", { count, credits });
      setMessage("兑换码已生成");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">批量生成点数兑换码</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[120px_120px_auto]">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={500}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          value={credits}
          onChange={(event) => setCredits(Number(event.target.value))}
        />
        <button
          className="tool-button h-10"
          type="submit"
          disabled={!canSubmit}
        >
          生成
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </form>
  );
}

export function InviteCodeCreateForm() {
  const router = useRouter();
  const [count, setCount] = useState(10);
  const [maxUses, setMaxUses] = useState(1);
  const [initialCredits, setInitialCredits] = useState(100);
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit =
    count >= 1 &&
    count <= 200 &&
    maxUses >= 1 &&
    initialCredits >= 0 &&
    !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("生成中...");

    try {
      await postJson("/api/admin/invites", {
        count,
        maxUses,
        initialCredits,
        note: note.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setMessage("邀请码已生成");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">批量生成邀请码</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[120px_120px_140px_210px_minmax(180px,1fr)_auto]">
        <label className="grid gap-1">
          <span className="field-label">数量</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">可用次数</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={1}
            max={999}
            value={maxUses}
            onChange={(event) => setMaxUses(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">初始点数</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={0}
            value={initialCredits}
            onChange={(event) => setInitialCredits(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">过期时间</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">备注</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            placeholder="可选"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button
          className="tool-button h-10"
          type="submit"
          disabled={!canSubmit}
        >
          生成
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </form>
  );
}
