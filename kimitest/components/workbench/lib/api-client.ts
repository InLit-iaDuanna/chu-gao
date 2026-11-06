import { friendlyErrorMessage } from "@/components/shared/error-copy";

export type ApiResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
    };

export class ClientApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ClientApiError";
    this.code = code;
    this.status = status;
  }
}

export async function readApiResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  let payload: ApiResponse<T>;

  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ClientApiError(
      friendlyErrorMessage({ code: "SERVICE_UNAVAILABLE" }, fallback),
      "SERVICE_UNAVAILABLE",
      response.status,
    );
  }

  if (!payload.ok) {
    throw new ClientApiError(
      friendlyErrorMessage(payload.error, fallback),
      payload.error.code,
      response.status,
    );
  }

  return payload.data;
}

export function isClientApiError(error: unknown): error is ClientApiError {
  return error instanceof ClientApiError;
}

export function isUnauthorizedError(error: unknown): boolean {
  return (
    isClientApiError(error) &&
    (error.status === 401 || error.code === "UNAUTHORIZED")
  );
}

export function isMissingConversationError(error: unknown): boolean {
  return (
    isClientApiError(error) &&
    (error.status === 404 ||
      error.code === "NOT_FOUND" ||
      error.code === "CONVERSATION_NOT_FOUND")
  );
}
