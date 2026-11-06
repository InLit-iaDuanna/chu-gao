import { PROVIDER_FETCH_RETRY } from "@/lib/http";
import type { InternalRequest } from "@/lib/models/types";

export function generationFetchRetry(request: InternalRequest) {
  return request.executionPolicy === "single-submit"
    ? undefined
    : PROVIDER_FETCH_RETRY;
}

export class ProviderSubmissionUnknownError extends Error {
  constructor(readonly cause: unknown) {
    super(
      "上游生成结果尚未确认，系统没有自动重发。请联系管理员核查后再决定是否重新生成。",
    );
    this.name = "ProviderSubmissionUnknownError";
  }
}
