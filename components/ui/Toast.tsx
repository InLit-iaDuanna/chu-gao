"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

import { IconButton } from "./IconButton";

type ToastVariant = "default" | "success" | "danger";

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends ToastOptions {
  id: string;
  // 退场中：播放 CSS 离场动画，动画结束后才真正从列表移除。
  leaving?: boolean;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantClass: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-success/35",
  danger: "border-danger/45",
};

const AUTO_DISMISS_MS = 4000;
const LEAVE_MS = 160;

export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  // 两段式移除：先标记 leaving 播放离场动画，动画结束后出列。
  const remove = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((items) =>
        items.map((item) =>
          item.id === id ? { ...item, leaving: true } : item,
        ),
      );
      const handle = window.setTimeout(() => {
        timers.current.delete(id);
        setToasts((items) => items.filter((item) => item.id !== id));
      }, LEAVE_MS);
      timers.current.set(id, handle);
    },
    [clearTimer],
  );

  const scheduleDismiss = useCallback(
    (id: string, variant: ToastVariant) => {
      // Errors persist until explicitly dismissed (WCAG 2.2.1 — don't auto-hide critical info).
      if (variant === "danger") {
        return;
      }
      clearTimer(id);
      const handle = window.setTimeout(() => remove(id), AUTO_DISMISS_MS);
      timers.current.set(id, handle);
    },
    [clearTimer, remove],
  );

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = crypto.randomUUID();
      const variant = opts.variant ?? "default";
      setToasts((items) => [...items, { id, ...opts, variant }]);
      scheduleDismiss(id, variant);
    },
    [scheduleDismiss],
  );

  // Clear any pending timers on unmount so they never fire against a gone provider.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((handle) => window.clearTimeout(handle));
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  const renderToast = (item: ToastItem): React.ReactElement => {
    const variant = item.variant ?? "default";
    return (
      <div
        key={item.id}
        className={cn(
          "pointer-events-auto rounded-md border bg-surface p-3 shadow-[var(--shadow-md)]",
          item.leaving ? "toast-leave" : "toast-enter",
          variantClass[variant],
        )}
        // 悬停/聚焦暂停自动消失；退场中的 toast 不再重排定时器（否则会卡在透明态）。
        onMouseEnter={() => {
          if (!item.leaving) clearTimer(item.id);
        }}
        onMouseLeave={() => {
          if (!item.leaving) scheduleDismiss(item.id, variant);
        }}
        onFocusCapture={() => {
          if (!item.leaving) clearTimer(item.id);
        }}
        onBlurCapture={() => {
          if (!item.leaving) scheduleDismiss(item.id, variant);
        }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            {item.description ? (
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {item.description}
              </p>
            ) : null}
          </div>
          <IconButton
            aria-label="关闭提示"
            size="sm"
            onClick={() => remove(item.id)}
          >
            <X />
          </IconButton>
        </div>
      </div>
    );
  };

  const polite = toasts.filter((item) => item.variant !== "danger");
  const assertive = toasts.filter((item) => item.variant === "danger");

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Always-mounted live regions so screen-reader announcements fire reliably. */}
      <div className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-[60] flex w-[min(360px,calc(100vw-24px))] flex-col gap-2 md:bottom-4 md:right-4 md:w-[min(360px,calc(100vw-32px))]">
        <div
          role="alert"
          aria-live="assertive"
          aria-relevant="additions"
          className="flex flex-col gap-2"
        >
          {assertive.map(renderToast)}
        </div>
        <div
          role="status"
          aria-live="polite"
          aria-relevant="additions"
          className="flex flex-col gap-2"
        >
          {polite.map(renderToast)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider.");
  }
  return context;
}
