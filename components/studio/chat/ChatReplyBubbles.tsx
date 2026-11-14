"use client";

import type { ReactNode } from "react";
import { Check, CircleAlert, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatActivityLabel } from "../lib/chat-turn-api";
import type { CreditSettlement } from "@/lib/turn-credit-types";

export const NO_CREDIT_CHARGE: CreditSettlement = {
  state: "not_applicable",
  chargedCredits: 0,
};
const creditNumber = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 6 });

function settlementLabel(billing?: CreditSettlement | null) {
  if (!billing || billing.state === "unknown") return "待确认";
  if (billing.state === "reserved")
    return `待结算${billing.reservedCredits !== undefined ? `（已预留 ${creditNumber(billing.reservedCredits)}）` : ""}`;
  if (billing.state === "refund_pending")
    return `退款待确认${billing.reservedCredits !== undefined ? `（已扣 ${creditNumber(billing.reservedCredits)}）` : ""}`;
  if (billing.chargedCredits === null) return "待确认";
  const amount = creditNumber(billing.chargedCredits);
  if (billing.state === "usage_unknown")
    return `${amount}（用量未确认，未扣费）`;
  if (billing.state === "usage_invalid") return `${amount}（用量异常，未扣费）`;
  if (billing.state === "released") return `${amount}（未扣费）`;
  if (billing.refundedCredits)
    return `${amount}（已退 ${creditNumber(billing.refundedCredits)}）`;
  return amount;
}

export function TurnCredits({
  chat,
  image,
}: {
  chat?: CreditSettlement | null;
  image?: CreditSettlement | null;
}) {
  const total =
    chat?.chargedCredits !== null &&
    chat?.chargedCredits !== undefined &&
    image?.chargedCredits !== null &&
    image?.chargedCredits !== undefined
      ? Number((chat.chargedCredits + image.chargedCredits).toFixed(6))
      : null;
  // A turn without an image job has one number; do not spell out a zero
  // image line and a total that repeats the chat line.
  const imageApplies = image?.state !== "not_applicable";
  return (
    <p
      aria-label="本轮积分"
      className="ml-auto flex min-w-0 flex-wrap justify-end gap-x-3 pl-3 text-[11px] leading-5 text-text-faint"
    >
      <span>聊天实际积分：{settlementLabel(chat)}</span>
      {imageApplies ? (
        <>
          <span>生图实际积分：{settlementLabel(image)}</span>
          <span>
            合计：
            {total === null ? "待结算" : `${creditNumber(total)} 积分`}
          </span>
        </>
      ) : null}
    </p>
  );
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function chatUsageBreakdown(
  usage: Record<string, unknown> | null | undefined,
) {
  const details = (usage?.input_tokens_details ??
    usage?.prompt_tokens_details) as Record<string, unknown> | undefined;
  const inputTotal = count(usage?.input_tokens ?? usage?.prompt_tokens);
  const output = count(usage?.output_tokens ?? usage?.completion_tokens);
  const cacheRead = count(
    details?.cached_tokens ?? usage?.cache_read_input_tokens,
  );
  const cacheCreation = count(
    usage?.cache_creation_input_tokens ??
      details?.cache_write_tokens ??
      details?.cached_creation_tokens,
  );
  const uncachedInput =
    inputTotal !== null && (cacheRead ?? 0) + (cacheCreation ?? 0) <= inputTotal
      ? inputTotal - (cacheRead ?? 0) - (cacheCreation ?? 0)
      : null;
  return { inputTotal, uncachedInput, cacheRead, cacheCreation, output };
}

export function ActivityTrail({
  history,
  current,
  active,
  statusOverride,
  status,
}: {
  history?: string[];
  current?: string;
  active: boolean;
  statusOverride?: string;
  status?: string;
}) {
  const entries = [...(history ?? [])];
  if (current && entries.at(-1) !== current) entries.push(current);
  if (!entries.length) return null;
  const lastIndex = entries.length - 1;
  const currentLabel = statusOverride
    ? statusOverride
    : current
      ? chatActivityLabel(current)
      : "正在处理…";
  const interrupted = Boolean(
    status && !["completed", "queued", "running"].includes(status),
  );
  const summary = active
    ? currentLabel
    : interrupted
      ? status === "cancelled"
        ? "文字回复已停止"
        : "文字回复未完成"
      : `已完成 · ${entries.length} 个步骤`;

  return (
    <details aria-label="过程" className="group mb-3 min-w-0" open={active}>
      <summary
        className={cn(
          "-mx-1.5 inline-flex max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm leading-5 hover:bg-[rgb(var(--text)/0.05)] hover:text-foreground [&::-webkit-details-marker]:hidden",
          active ? "text-foreground" : "text-text-muted",
        )}
      >
        {interrupted ? <CircleAlert size={13} className="shrink-0" /> : null}
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ol className="mt-2 min-w-0 space-y-1.5 rounded-lg border border-border px-3.5 py-3">
        {entries.map((activity, index) => {
          const isCurrent = active && index === lastIndex;
          return (
            <li
              key={`${activity}-${index}`}
              className={cn(
                "flex min-w-0 items-center gap-2.5 text-[13px] leading-5",
                isCurrent ? "text-foreground" : "text-text-muted",
              )}
            >
              {isCurrent ? (
                <Loader2 size={12} className="shrink-0 animate-spin" />
              ) : interrupted && index === lastIndex ? (
                <CircleAlert size={12} className="shrink-0" />
              ) : (
                <Check size={12} className="shrink-0" />
              )}
              <span className="min-w-0 break-words">
                {isCurrent && statusOverride
                  ? statusOverride
                  : chatActivityLabel(activity)}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

export function ResultBubble({
  children,
  streaming = false,
}: {
  children: ReactNode;
  streaming?: boolean;
}) {
  return (
    <section
      aria-label="回答"
      className={cn("min-w-0", streaming && "relative")}
    >
      {children}
    </section>
  );
}
