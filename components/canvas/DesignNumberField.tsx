"use client";

import { useEffect, useRef, useState } from "react";

export function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const formattedValue = String(Number(value.toFixed(2)));
  const [draft, setDraft] = useState(formattedValue);
  const cancelBlurRef = useRef(false);

  useEffect(() => setDraft(formattedValue), [formattedValue]);

  const commitDraft = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) onChange(next);
    else setDraft(formattedValue);
  };

  return (
    <label className="flex h-8 items-center gap-1 rounded border border-border px-2 text-[10px] text-text-faint">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelBlurRef.current) {
            cancelBlurRef.current = false;
            setDraft(formattedValue);
            return;
          }
          commitDraft();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            cancelBlurRef.current = true;
            setDraft(formattedValue);
            event.currentTarget.blur();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-right text-xs text-foreground outline-none"
      />
    </label>
  );
}
