import type { NextResponse } from "next/server";

import type { ApiFailResponse } from "@/lib/api-response";
import { fail } from "@/lib/api-response";

export class InvalidJsonBodyError extends Error {
  constructor(message = "请求体不是合法 JSON") {
    super(message);
    this.name = "InvalidJsonBodyError";
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidJsonBodyError();
    }

    throw error;
  }
}

export async function readJsonBodySafe(
  request: Request,
  message = "请求体不是合法 JSON",
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse<ApiFailResponse> }
> {
  try {
    return {
      ok: true,
      data: await readJsonBody(request),
    };
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      return {
        ok: false,
        response: fail("VALIDATION_ERROR", message, { status: 400 }),
      };
    }

    throw error;
  }
}
