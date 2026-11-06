import { request } from "@/components/studio/lib/api";

export type AgentAuthorizationMode = "single" | "timed";

export interface AgentAuthorization {
  id: string;
  clientName: string;
  mode: AgentAuthorizationMode;
  status?: "active" | "expired" | "revoked" | "invalidated";
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AgentDeviceAuthorization {
  userCode: string;
  clientName: string;
  status: "pending" | "approved" | "denied" | "consumed" | "expired";
  expiresAt: string;
  account: { email: string; credits: number };
}

interface AgentDecision {
  userCode: string;
  decision: "approve" | "deny";
  mode: AgentAuthorizationMode;
  durationHours?: number;
}

export const listAgentAuthorizations = (signal?: AbortSignal) =>
  request<AgentAuthorization[]>("/api/agent/authorizations", {
    cache: "no-store",
    signal,
  });

export const getAgentDeviceAuthorization = (
  userCode: string,
  signal?: AbortSignal,
) =>
  request<AgentDeviceAuthorization>(
    `/api/agent/authorize?${new URLSearchParams({ user_code: userCode })}`,
    { cache: "no-store", signal },
  );

export const decideAgentAuthorization = (decision: AgentDecision) =>
  request<{ status: "approved" | "denied"; expiresAt?: string }>(
    "/api/agent/authorize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    },
  );

export const revokeAgentAuthorization = (id: string) =>
  request<{ revoked: true }>(
    `/api/agent/authorizations/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: { "Content-Type": "application/json" } },
  );
