"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";

export function CopyTextButton({
  text,
  label = "复制提示词",
  showText = false,
}: {
  text: string;
  label?: string;
  showText?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({
        title: "复制失败",
        description: "请选中文字后复制，或检查浏览器剪贴板权限",
        variant: "danger",
      });
    }
  };

  return (
    <IconButton
      type="button"
      variant="ghost"
      aria-label={label}
      title={copied ? "已复制" : label}
      disabled={!text}
      onClick={() => void copy()}
      className={cn(
        "shrink-0 text-text-muted hover:text-foreground",
        showText
          ? "h-9 w-auto gap-1.5 rounded-md px-2 text-xs"
          : "h-11 w-11 sm:h-8 sm:w-8",
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        {copied ? (
          <Check size={16} className="text-success" />
        ) : (
          <Copy size={16} />
        )}
        {showText ? <span>{copied ? "已复制" : label}</span> : null}
      </span>
    </IconButton>
  );
}
