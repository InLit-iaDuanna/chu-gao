"use client";

import type { ReactNode } from "react";

import {
  EmptyState,
  FormField,
  Table,
  TableContainer,
  TableHead,
  TableHeader,
} from "@/components/ui";
import { cn } from "@/lib/utils";

import type { Health } from "./lib/types";

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-xs leading-5 text-text-faint">{eyebrow}</p>
        <h1 className="mt-1 break-words text-xl font-semibold leading-7 tracking-normal">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 break-words text-sm leading-6 text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-text-muted">{label}</p>
      <p
        className={cn(
          "mt-1.5 break-words font-mono text-2xl font-semibold tracking-normal tabular-nums",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs leading-5 text-text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function HealthBadge({ health }: { health: Health }) {
  const map: Record<Health, { label: string; className: string }> = {
    HEALTHY: { label: "健康", className: "text-success" },
    DEGRADED: { label: "降级", className: "text-warning" },
    DOWN: { label: "离线", className: "text-danger" },
  };
  const item = map[health];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs", item.className)}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {item.label}
    </span>
  );
}

export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        active ? "text-success" : "text-text-faint",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {active ? "启用" : "停用"}
    </span>
  );
}

export function AdminTable({
  head,
  children,
}: {
  head: ReactNode[];
  children: ReactNode;
}) {
  return (
    <TableContainer className="min-w-0 max-w-full">
      <Table>
        <TableHeader className="bg-surface-2">
          <tr className="border-b border-border text-left">
            {head.map((cell, index) => (
              <TableHead key={index}>{cell}</TableHead>
            ))}
          </tr>
        </TableHeader>
        <tbody>{children}</tbody>
      </Table>
    </TableContainer>
  );
}

export function AdminField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <FormField label={label} className={className}>
      {children}
    </FormField>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-3 break-words text-sm leading-6 text-danger">
      {message}
    </p>
  );
}

export function EmptyPanel({ text }: { text: string }) {
  return <EmptyState className="border-y border-border" title={text} />;
}
