import { request } from "@/components/studio/lib/api";

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  usedCredits: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyResult extends ApiKey {
  key: string;
}

export const listApiKeys = (signal?: AbortSignal) =>
  request<ApiKey[]>("/api/v1/keys", { cache: "no-store", signal }).then(
    (data) => (Array.isArray(data) ? data : (data as { items: ApiKey[] }).items),
  );

export const createApiKey = (body: { name: string; expiresAt?: string }) =>
  request<CreateApiKeyResult>("/api/v1/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const revokeApiKey = (id: string) =>
  request<{ revoked: true }>(`/api/v1/keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
