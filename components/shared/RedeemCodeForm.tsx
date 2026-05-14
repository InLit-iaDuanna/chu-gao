"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, FormField, Input, useToast } from "@/components/ui";

export function RedeemCodeForm(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = code.trim().length > 0 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);

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
        toast({
          title: "兑换失败",
          description: payload?.error?.message ?? "请检查兑换码后重试。",
          variant: "danger",
        });
        return;
      }

      setCode("");
      toast({
        title: "兑换成功",
        description: `已兑换 ${payload?.data?.credits ?? 0} 点，当前余额 ${payload?.data?.balance ?? 0} 点。`,
        variant: "success",
      });
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      id="redeem-code"
      onSubmit={submit}
      className="mt-6 rounded-lg border border-border p-4"
    >
      <p className="text-sm font-medium">兑换点数码</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <FormField label="兑换码">
          <Input
            inputSize="lg"
            placeholder="输入兑换码"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </FormField>
        <Button
          className="self-end"
          loading={isSubmitting}
          type="submit"
          disabled={!canSubmit}
        >
          兑换
        </Button>
      </div>
    </form>
  );
}
