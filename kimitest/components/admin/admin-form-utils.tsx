"use client";

import { useEffect } from "react";

export type AdminToastType = "success" | "error" | "info";

export interface AdminToastState {
  show: boolean;
  type: AdminToastType;
  message: string;
}

async function requestJson(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "操作失败");
  }

  return payload;
}

export async function postJson(url: string, body: unknown) {
  return requestJson(url, "POST", body);
}

export async function patchJson(url: string, body: unknown) {
  return requestJson(url, "PATCH", body);
}

export async function deleteJson(url: string, body: unknown) {
  return requestJson(url, "DELETE", body);
}

export function toDatetimeLocalValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function AdminToast({
  show,
  type,
  message,
  onClose,
}: AdminToastState & { onClose: () => void }): React.ReactElement | null {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [show, onClose]);

  if (!show) {
    return null;
  }

  const bgColor = {
    success: "bg-[rgb(var(--success)_/_0.1)]",
    error: "bg-[rgb(var(--danger)_/_0.1)]",
    info: "bg-[rgb(var(--info)_/_0.1)]",
  }[type];

  const borderColor = {
    success: "border-[rgb(var(--success))]",
    error: "border-[rgb(var(--danger))]",
    info: "border-[rgb(var(--info))]",
  }[type];

  const textColor = {
    success: "text-[rgb(var(--success))]",
    error: "text-[rgb(var(--danger))]",
    info: "text-[rgb(var(--info))]",
  }[type];

  const icon = {
    success: (
      <svg
        className="h-5 w-5 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    error: (
      <svg
        className="h-5 w-5 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    info: (
      <svg
        className="h-5 w-5 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  }[type];

  return (
    <div
      className={`toast-enter-down fixed left-1/2 top-6 z-50 flex w-full max-w-md items-center gap-3 border-3 ${borderColor} ${bgColor} px-4 py-3 shadow-[var(--shadow-brutal-md)]`}
      style={{
        borderRadius: "8px",
        // 水平居中 + 轻微倾斜都放在 transform 里；不要再叠加 -translate-x-1/2
        // （Tailwind v4 的 translate 工具类走独立 translate 属性，会和这里的
        // transform 叠加成双重偏移，也会跟 toast-enter-down 的入场动画打架）。
        transform: "translate(-50%, 0) rotate(-0.5deg)",
      }}
    >
      <span className={textColor}>{icon}</span>
      <p className={`flex-1 text-sm font-medium ${textColor}`}>{message}</p>
      <button
        onClick={onClose}
        className={`${textColor} transition-opacity hover:opacity-70`}
        aria-label="关闭"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
