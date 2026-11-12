import type { ModelCallLog } from "@prisma/client";

import { sanitizeCallContent, sanitizeCallText } from "@/lib/model-call-log";

export interface AdminCallUser {
  email: string;
  name: string | null;
}

export function serializeAdminModelCall(
  item: ModelCallLog,
  user: AdminCallUser | null,
  options: { includeContent?: boolean } = {},
) {
  const {
    requestContent: rawRequestContent,
    responseContent: rawResponseContent,
    ...summary
  } = item;
  return {
    ...summary,
    errorMessage: summary.errorMessage
      ? sanitizeCallText(summary.errorMessage)
      : null,
    ...(options.includeContent === false
      ? {}
      : {
          requestContent: sanitizeCallContent(rawRequestContent) ?? null,
          responseContent: sanitizeCallContent(rawResponseContent) ?? null,
        }),
    userEmail: user?.email ?? null,
    userName: user?.name ?? null,
  };
}
