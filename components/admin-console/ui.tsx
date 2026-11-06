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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
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
    <div className="surface-panel p-4">
      <p className="text-xs text-text-muted">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-mono text-2xl font-semibold tracking-tight",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-text-faint">{hint}</p> : null}
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
    <TableContainer>
      <Table>
        <TableHeader>
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
  return <p className="text-sm text-danger">{message}</p>;
}

export function EmptyPanel({ text }: { text: string }) {
  return <EmptyState className="surface-panel" title={text} />;
}
