import { NextResponse } from "next/server";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccessResponse<T> {
  ok: true;
  data: T;
}

export interface ApiFailResponse {
  ok: false;
  error: ApiErrorBody;
}

export function errorBody(
  code: string,
  message: string,
  details?: unknown,
): ApiFailResponse {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function ok<T>(
  data: T,
  init?: ResponseInit,
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(
  code: string,
  message: string,
  init?: ResponseInit & { details?: unknown },
): NextResponse<ApiFailResponse> {
  return NextResponse.json(errorBody(code, message, init?.details), init);
}
