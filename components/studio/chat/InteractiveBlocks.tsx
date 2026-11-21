"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  joinAskAnswer,
  selectedAskOptions,
  type AskBlock,
  type NextBlock,
} from "../lib/chat-interactive-blocks";
import styles from "./InteractiveBlocks.module.css";

/** Sends text as a user message; resolving to false means it was not sent. */
export type QuickReplyHandler = (
  text: string,
) => void | boolean | Promise<boolean | void>;

function settle(result: ReturnType<QuickReplyHandler>, onRejected: () => void) {
  void Promise.resolve(result).then(
    (ok) => {
      if (ok === false) onRejected();
    },
    onRejected,
  );
}

export function AskCard({
  ask,
  enabled,
  answer,
  onReply,
}: {
  ask: AskBlock;
  /** Only the latest assistant reply, with no turn in flight, accepts clicks. */
  enabled: boolean;
  /** The user message that followed this reply, used to mark the chosen option. */
  answer?: string | null;
  onReply?: QuickReplyHandler;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [sent, setSent] = useState<string | null>(null);
  const active = enabled && sent === null && Boolean(onReply);
  const reply = (text: string) => {
    if (!active || !text) return;
    setSent(text);
    settle(onReply!(text), () => setSent(null));
  };

  if (!active) {
    // Until the sent message lands in the history, mark what was just clicked.
    const chosen = selectedAskOptions(ask, answer ?? sent);
    return (
      <section
        aria-label="助手提问"
        className={cn(styles.card, styles.compact)}
        data-state="disabled"
      >
        <p className={styles.question}>{ask.question}</p>
        <ul className={styles.compactOptions}>
          {ask.options.map((option, index) => {
            const selected = chosen.has(option.label);
            return (
              <li
                key={index}
                className={styles.compactOption}
                data-selected={selected ? "true" : undefined}
              >
                {selected ? (
                  <Check size={12} strokeWidth={2.25} aria-hidden />
                ) : null}
                <span>{option.label}</span>
                {selected ? <span className="sr-only">（已选）</span> : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <section aria-label="助手提问" className={styles.card}>
      <p className={styles.question}>{ask.question}</p>
      <div
        className={styles.options}
        role={ask.multiple ? "group" : undefined}
        aria-label={ask.multiple ? "可多选" : undefined}
      >
        {ask.options.map((option, index) => {
          const isChecked = checked.has(option.label);
          return (
            <button
              key={index}
              type="button"
              className={styles.option}
              aria-pressed={ask.multiple ? isChecked : undefined}
              data-selected={isChecked ? "true" : undefined}
              onClick={() => {
                if (!ask.multiple) return reply(option.label);
                setChecked((current) => {
                  const nextSet = new Set(current);
                  if (nextSet.has(option.label)) nextSet.delete(option.label);
                  else nextSet.add(option.label);
                  return nextSet;
                });
              }}
            >
              {ask.multiple ? (
                <span className={styles.checkbox} aria-hidden>
                  {isChecked ? <Check size={12} strokeWidth={2.5} /> : null}
                </span>
              ) : null}
              <span className={styles.optionText}>
                <span className={styles.optionLabel}>{option.label}</span>
                {option.description ? (
                  <span className={styles.optionDescription}>
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {ask.multiple ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.submit}
            disabled={checked.size === 0}
            onClick={() => reply(joinAskAnswer(ask, checked))}
          >
            发送
          </button>
        </div>
      ) : null}
      <p className={styles.hint}>也可以直接在输入框里回复</p>
    </section>
  );
}

export function QuickReplies({
  next,
  onReply,
}: {
  next: NextBlock;
  onReply: QuickReplyHandler;
}) {
  const [sent, setSent] = useState(false);
  return (
    <div role="group" aria-label="快捷回复" className={styles.quickReplies}>
      {next.options.map((option, index) => (
        <button
          key={index}
          type="button"
          className={styles.chip}
          disabled={sent}
          onClick={() => {
            setSent(true);
            settle(onReply(option), () => setSent(false));
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
