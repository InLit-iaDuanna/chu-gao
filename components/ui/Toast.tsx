"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantClass: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-success/35",
  danger: "border-danger/35",
};

export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = crypto.randomUUID();
      setToasts((items) => [...items, { id, variant: "default", ...opts }]);
      window.setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cn(
              "rounded-md border bg-surface p-3 shadow-[var(--shadow-md)]",
              variantClass[item.variant ?? "default"],
            )}
            role={item.variant === "danger" ? "alert" : "status"}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {item.title}
                </p>
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
        ))}
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
