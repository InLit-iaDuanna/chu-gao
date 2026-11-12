export interface CreditSettlement {
  state: string;
  chargedCredits: number | null;
  reservedCredits?: number;
  refundedCredits?: number;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function readCreditSettlement(value: unknown): CreditSettlement | null {
  const entry = object(value);
  if (
    typeof entry.state !== "string" ||
    !(
      entry.chargedCredits === null ||
      (typeof entry.chargedCredits === "number" &&
        Number.isFinite(entry.chargedCredits) &&
        entry.chargedCredits >= 0)
    )
  )
    return null;
  return {
    state: entry.state,
    chargedCredits: entry.chargedCredits,
    ...(typeof entry.reservedCredits === "number" &&
    Number.isFinite(entry.reservedCredits) &&
    entry.reservedCredits >= 0
      ? { reservedCredits: entry.reservedCredits }
      : {}),
    ...(typeof entry.refundedCredits === "number" &&
    Number.isFinite(entry.refundedCredits) &&
    entry.refundedCredits >= 0
      ? { refundedCredits: entry.refundedCredits }
      : {}),
  };
}

export function chatCreditSettlement(input: {
  billingState: string;
  chargedCredits: number;
  heldCredits: number;
}): CreditSettlement {
  return {
    state: input.billingState,
    chargedCredits:
      input.billingState === "reserved" ? null : input.chargedCredits,
    ...(input.billingState === "reserved"
      ? { reservedCredits: input.heldCredits }
      : {}),
  };
}

// Earlier errors described the entire round as free, even when its image was billed.
export function chatReplyErrorMessage(message: string) {
  return message.replace(/本轮未收费/g, "文字回复未收费");
}
