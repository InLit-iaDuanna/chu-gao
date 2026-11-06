export class InspirationApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function inspirationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: T;
    error?: { code?: string; message?: string };
  } | null;
  if (response.ok && payload?.ok) return payload.data as T;
  throw new InspirationApiError(
    payload?.error?.code ?? `HTTP_${response.status}`,
    payload?.error?.message ?? "请求失败，请稍后重试",
    response.status,
  );
}

export function loginForCurrentPage(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/login?next=${encodeURIComponent(next)}`;
}
