/** Runtime annotations are bounded diagnostic hints. They never grant tools,
 * increase budgets, choose accounts, or change the upstream request body.
 */
export interface ResearchCallTrace {
  purpose?: string;
  declaredTaskSpecHash?: string;
  declaredContextHash?: string;
}
export function boundedResearchCallTrace(
  value: ResearchCallTrace = {},
): ResearchCallTrace {
  const hash = (input?: string) =>
    input && /^[a-f0-9]{64}$/.test(input) ? input : undefined;
  const purpose =
    value.purpose && /^research\.[a-z0-9_.-]{1,70}$/.test(value.purpose)
      ? value.purpose
      : undefined;
  return {
    ...(purpose ? { purpose } : {}),
    ...(hash(value.declaredTaskSpecHash)
      ? { declaredTaskSpecHash: value.declaredTaskSpecHash }
      : {}),
    ...(hash(value.declaredContextHash)
      ? { declaredContextHash: value.declaredContextHash }
      : {}),
  };
}
export function researchCallTraceFromHeaders(headers: Headers) {
  return boundedResearchCallTrace({
    purpose: headers.get("X-Chugao-Call-Purpose") ?? undefined,
    declaredTaskSpecHash: headers.get("X-Chugao-Task-Spec-Hash") ?? undefined,
    declaredContextHash: headers.get("X-Chugao-Context-Hash") ?? undefined,
  });
}
