import { Prisma } from "@prisma/client";
import {
  chatTokenCost,
  normalizeChatTokenUsage,
  readChatTokenPricingSnapshot,
} from "@/lib/chat-token-billing";

type Amount = string | number | Prisma.Decimal;
type Reference = { id: string };

export interface ChatLedgerAuditInput {
  users: Reference[];
  conversations: { id: string; userId: string }[];
  turns: {
    id: string;
    userId: string;
    conversationId: string;
    clientRequestId: string;
    inputHash: string;
    status: string;
    activeConversationId: string | null;
    activeAttemptId: string | null;
    chargedCredits: Amount;
  }[];
  attempts: {
    id: string;
    turnId: string;
    status: string;
    billingState: string;
    heldCredits: Amount;
  }[];
  entries: {
    id: string;
    operationKey: string;
    kind: string;
    userId: string;
    turnId: string | null;
    attemptId: string | null;
    turnSettlementKey: string | null;
    availableDelta: Amount;
    heldDelta: Amount;
    consumedDelta: Amount;
    result?: unknown;
  }[];
  receipts: {
    id: string;
    userId: string;
    scope: string;
    clientRequestId: string;
    inputHash: string;
    conversationId: string;
    turnId: string;
    attemptId: string | null;
    contentClearedAt: Date | string | null;
  }[];
  usages: {
    id: string;
    userId: string;
    action: string;
    creditsDelta: Amount;
    metadata: unknown;
  }[];
  messages?: {
    id: string;
    conversationId: string;
    chatTurnId: string | null;
    chatAttemptId: string | null;
  }[];
  events?: { id: string; turnId: string; attemptId: string }[];
}

export interface ChatLedgerAuditIssue {
  code: string;
  ref: string;
  detail: string;
}

const active = new Set(["queued", "running"]);
const terminal = new Set([
  "completed",
  "failed",
  "incomplete",
  "cancelled",
  "interrupted",
]);
const zero = () => new Prisma.Decimal(0);
const metadataObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// This is a chat hold audit, not a reconstruction of User.credits. Other products,
// redemptions and administrative adjustments are outside this projection.
export function auditChatLedger(input: ChatLedgerAuditInput) {
  const issues: ChatLedgerAuditIssue[] = [];
  const issueCounts: Record<string, number> = {};
  let issueCount = 0;
  const issue = (code: string, ref: string, detail: string) => {
    issueCount += 1;
    issueCounts[code] = (issueCounts[code] ?? 0) + 1;
    if (issues.length < 200) issues.push({ code, ref, detail });
  };
  const amount = (value: Amount, ref: string) => {
    try {
      const result = new Prisma.Decimal(value);
      if (!result.isFinite()) throw new Error("Non-finite amount");
      return result.toDecimalPlaces(6);
    } catch {
      issue(
        "invalid_amount",
        ref,
        "Expected a finite six-decimal credit amount.",
      );
      return zero();
    }
  };
  const users = new Set(input.users.map((row) => row.id));
  const conversations = new Map(
    input.conversations.map((row) => [row.id, row]),
  );
  const turns = new Map(input.turns.map((row) => [row.id, row]));
  const attempts = new Map(input.attempts.map((row) => [row.id, row]));
  const cleared = new Set(
    input.receipts
      .filter((row) => row.contentClearedAt !== null)
      .map((row) => JSON.stringify([row.userId, row.turnId])),
  );
  const isCleared = (userId: string, turnId: string) =>
    cleared.has(JSON.stringify([userId, turnId]));
  const operations = new Set<string>();
  const settlementKeys = new Set<string>();
  const reserveByAttempt = new Map<string, ChatLedgerAuditInput["entries"]>();
  const closeByAttempt = new Map<string, ChatLedgerAuditInput["entries"]>();
  const settlementsByTurn = new Map<string, ChatLedgerAuditInput["entries"]>();
  const heldByUser = new Map<string, Prisma.Decimal>();
  const reservedByUser = new Map<string, Prisma.Decimal>();
  const consumedByTurn = new Map<string, Prisma.Decimal>();
  const createReceipts = new Map(
    input.receipts
      .filter((row) => row.scope === "create")
      .map((row) => [
        JSON.stringify([row.userId, row.turnId, row.clientRequestId]),
        row,
      ]),
  );
  // Read-only operational projections may omit CreditEntry.result. The matching
  // UsageLog retains the same frozen billing receipt after content is cleared.
  const billingByAttempt = new Map<string, Record<string, unknown>>();
  for (const usage of input.usages) {
    const metadata = metadataObject(usage.metadata);
    const billing = metadataObject(metadataObject(metadata.usage).billing);
    if (
      usage.action === "conversation.chat" &&
      typeof metadata.attemptId === "string" &&
      billing.tokenPricing
    )
      billingByAttempt.set(metadata.attemptId, billing);
  }
  const billingResult = (
    entry: ChatLedgerAuditInput["entries"][number] | undefined,
  ) =>
    metadataObject(
      entry?.result ??
        (entry?.attemptId ? billingByAttempt.get(entry.attemptId) : undefined),
    );
  const add = (
    map: Map<string, Prisma.Decimal>,
    key: string,
    value: Prisma.Decimal,
  ) => map.set(key, (map.get(key) ?? zero()).plus(value));
  const append = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const rows = map.get(key);
    if (rows) rows.push(value);
    else map.set(key, [value]);
  };

  for (const row of input.entries) {
    if (
      !row.kind.startsWith("chat.") &&
      !row.turnId &&
      !row.attemptId &&
      !row.turnSettlementKey &&
      !/^(reserve|close):/.test(row.operationKey)
    )
      continue;
    const ref = `entry:${row.id}`;
    if (operations.has(row.operationKey))
      issue("duplicate_operation_key", ref, row.operationKey);
    operations.add(row.operationKey);
    if (!users.has(row.userId)) issue("orphan_user", ref, row.userId);
    if (!row.turnId || !row.attemptId) {
      issue(
        "missing_ledger_reference",
        ref,
        "Chat entries require turnId and attemptId.",
      );
      continue;
    }
    const turn = turns.get(row.turnId);
    const attempt = attempts.get(row.attemptId);
    const clearedContent =
      !turn && !attempt && isCleared(row.userId, row.turnId);
    if ((!turn || !attempt) && !clearedContent)
      issue(
        "orphan_ledger_reference",
        ref,
        "Missing or partially dangling content without a matching complete content-clear tombstone.",
      );
    if (turn && turn.userId !== row.userId)
      issue("ledger_user_mismatch", ref, turn.id);
    if (attempt && attempt.turnId !== row.turnId)
      issue("ledger_attempt_mismatch", ref, attempt.id);

    const available = amount(row.availableDelta, `${ref}:available`);
    const held = amount(row.heldDelta, `${ref}:held`);
    const consumed = amount(row.consumedDelta, `${ref}:consumed`);
    add(heldByUser, row.userId, held);
    add(consumedByTurn, row.turnId, consumed);
    if (!available.plus(held).plus(consumed).isZero())
      issue(
        "unbalanced_entry",
        ref,
        "availableDelta + heldDelta + consumedDelta must be zero.",
      );

    if (row.operationKey === `reserve:${row.attemptId}`) {
      append(reserveByAttempt, row.attemptId, row);
      if (
        row.kind !== "chat.reserve" ||
        held.lt(0) ||
        !available.eq(held.negated()) ||
        !consumed.isZero() ||
        row.turnSettlementKey !== null
      )
        issue(
          "invalid_reserve",
          ref,
          "Reserve must move available to held, without consumption or settlement key.",
        );
    } else if (row.operationKey === `close:${row.attemptId}`) {
      append(closeByAttempt, row.attemptId, row);
      const result = billingResult(row);
      const tokenPriced = result.tokenPricing !== undefined;
      if (held.gt(0) || available.lt(0) || consumed.lt(0))
        issue(
          "invalid_close",
          ref,
          "Close must remove held credits and release or consume them.",
        );
      if (row.turnSettlementKey !== null) {
        append(settlementsByTurn, row.turnId, row);
        if (settlementKeys.has(row.turnSettlementKey))
          issue("duplicate_settlement_key", ref, row.turnSettlementKey);
        settlementKeys.add(row.turnSettlementKey);
        if (
          row.kind !== "chat.settle" ||
          !(tokenPriced
            ? available.plus(consumed).eq(held.negated())
            : available.isZero() && consumed.eq(held.negated())) ||
          row.turnSettlementKey !== `settle:${row.turnId}`
        )
          issue(
            "invalid_settlement",
            ref,
            "Settlement must close the hold, refund or debit the difference, and have a turn key.",
          );
        if (tokenPriced) {
          try {
            const snapshot = readChatTokenPricingSnapshot(result.tokenPricing);
            const tokens = metadataObject(result.tokens);
            const normalized = normalizeChatTokenUsage({
              prompt_tokens: tokens.inputTokens,
              completion_tokens: tokens.outputTokens,
              prompt_tokens_details: { cached_tokens: tokens.cacheReadTokens },
              cache_creation_input_tokens: tokens.cacheCreationTokens,
            });
            if (
              !snapshot ||
              result.state !== "charged" ||
              normalized.availability !== "reported" ||
              !consumed.eq(
                chatTokenCost(normalized.tokens, snapshot.pricing),
              ) ||
              !consumed.eq(amount(result.chargedCredits as Amount, ref))
            )
              throw new Error(
                "Token settlement differs from frozen rates and actual usage.",
              );
          } catch {
            issue(
              "invalid_token_settlement",
              ref,
              "Token settlement must match reported usage and its frozen rates.",
            );
          }
        }
      } else if (
        row.kind !== "chat.release" ||
        !consumed.isZero() ||
        !available.eq(held.negated())
      ) {
        issue(
          "invalid_release",
          ref,
          "Release must return the hold without consumption.",
        );
      }
    } else {
      issue(
        "invalid_operation_key",
        ref,
        "Expected reserve:<attemptId> or close:<attemptId>.",
      );
    }
  }

  for (const id of new Set([
    ...reserveByAttempt.keys(),
    ...closeByAttempt.keys(),
    ...attempts.keys(),
  ])) {
    const ref = `attempt:${id}`;
    const reserves = reserveByAttempt.get(id) ?? [];
    const closes = closeByAttempt.get(id) ?? [];
    const attempt = attempts.get(id);
    if (
      reserves.length === 1 &&
      closes.some(
        (row) =>
          row.userId !== reserves[0].userId ||
          row.turnId !== reserves[0].turnId,
      )
    )
      issue(
        "close_reserve_reference_mismatch",
        ref,
        "Reserve and close must identify the same user and turn, including after content deletion.",
      );
    if (reserves.length !== 1)
      issue(
        "reserve_count",
        ref,
        `Expected one reserve, found ${reserves.length}.`,
      );
    if (closes.length > 1)
      issue(
        "close_count",
        ref,
        `Expected at most one close, found ${closes.length}.`,
      );
    const held = reserves.reduce(
      (sum, row) => sum.plus(amount(row.heldDelta, ref)),
      zero(),
    );
    const net = closes.reduce(
      (sum, row) => sum.plus(amount(row.heldDelta, ref)),
      held,
    );
    if (!attempt) {
      if (!net.isZero() || closes.length !== 1)
        issue(
          "deleted_attempt_hold",
          ref,
          "Deleted content must have exactly one close and no remaining hold.",
        );
      continue;
    }
    const turn = turns.get(attempt.turnId);
    if (!turn) issue("orphan_attempt", ref, attempt.turnId);
    const expected = amount(attempt.heldCredits, ref);
    if (expected.lt(0) || !held.eq(expected))
      issue(
        "hold_amount_mismatch",
        ref,
        `Reserve ${held.toFixed(6)}; attempt ${expected.toFixed(6)}.`,
      );
    if (!active.has(attempt.status) && !terminal.has(attempt.status))
      issue("unknown_attempt_status", ref, attempt.status);
    if (attempt.billingState === "reserved") {
      if (turn) add(reservedByUser, turn.userId, expected);
      if (
        closes.length !== 0 ||
        !net.eq(expected) ||
        !active.has(attempt.status)
      )
        issue(
          "reserved_state_mismatch",
          ref,
          "Reserved attempts must be active, with an open hold.",
        );
    } else if (
      ["charged", "released", "usage_unknown", "usage_invalid"].includes(
        attempt.billingState,
      )
    ) {
      if (closes.length !== 1 || !net.isZero() || !terminal.has(attempt.status))
        issue(
          "closed_state_mismatch",
          ref,
          "Terminal attempts require exactly one close and no remaining hold.",
        );
      const settled = closes.some((row) => row.turnSettlementKey !== null);
      const unbillable = ["usage_unknown", "usage_invalid"].includes(
        attempt.billingState,
      );
      const closeResult = billingResult(closes[0]);
      if (
        (attempt.billingState === "charged") !== settled ||
        (attempt.status === "completed" && !unbillable) !== settled ||
        (unbillable &&
          (attempt.status !== "completed" ||
            closeResult.state !== attempt.billingState ||
            !closeResult.tokenPricing ||
            typeof closeResult.reason !== "string" ||
            closeResult.usageAvailability !==
              (attempt.billingState === "usage_unknown"
                ? "unknown"
                : "reported")))
      )
        issue(
          "settlement_state_mismatch",
          ref,
          "Only a completed, charged attempt may have a settlement key.",
        );
    } else {
      issue("unknown_billing_state", ref, attempt.billingState);
    }
  }

  const receiptKeys = new Set<string>();
  for (const row of input.receipts) {
    const ref = `receipt:${row.id}`;
    const key = JSON.stringify([row.userId, row.scope, row.clientRequestId]);
    if (receiptKeys.has(key))
      issue("duplicate_receipt_key", ref, "Duplicate user/scope/request key.");
    receiptKeys.add(key);
    if (!users.has(row.userId)) issue("orphan_user", ref, row.userId);
    const turn = turns.get(row.turnId);
    const conversation = conversations.get(row.conversationId);
    const attempt = row.attemptId ? attempts.get(row.attemptId) : null;
    if (
      !row.contentClearedAt &&
      (!turn || !conversation || (row.attemptId && !attempt))
    )
      issue(
        "orphan_receipt_reference",
        ref,
        "Live receipt points to missing content.",
      );
    if (
      (turn &&
        (turn.userId !== row.userId ||
          turn.conversationId !== row.conversationId)) ||
      (conversation && conversation.userId !== row.userId) ||
      (attempt && attempt.turnId !== row.turnId)
    )
      issue(
        "receipt_reference_mismatch",
        ref,
        "Receipt ownership/turn/attempt does not match content.",
      );
  }

  for (const turn of input.turns) {
    const ref = `turn:${turn.id}`;
    const conversation = conversations.get(turn.conversationId);
    if (!users.has(turn.userId)) issue("orphan_user", ref, turn.userId);
    if (!conversation || conversation.userId !== turn.userId)
      issue("orphan_conversation", ref, turn.conversationId);
    if (!active.has(turn.status) && !terminal.has(turn.status))
      issue("unknown_turn_status", ref, turn.status);
    if (
      turn.activeConversationId !== null &&
      turn.activeConversationId !== turn.conversationId
    )
      issue("active_conversation_mismatch", ref, turn.activeConversationId);
    if (active.has(turn.status) !== (turn.activeConversationId !== null))
      issue(
        "active_turn_mismatch",
        ref,
        "Only queued/running turns should occupy the conversation.",
      );
    const attempt = turn.activeAttemptId
      ? attempts.get(turn.activeAttemptId)
      : null;
    if (
      !attempt ||
      attempt.turnId !== turn.id ||
      attempt.status !== turn.status
    )
      issue(
        "active_attempt_mismatch",
        ref,
        "Latest attempt pointer/status does not match turn.",
      );
    const receipt = createReceipts.get(
      JSON.stringify([turn.userId, turn.id, turn.clientRequestId]),
    );
    if (!receipt || receipt.inputHash !== turn.inputHash)
      issue(
        "missing_create_receipt",
        ref,
        "Turn has no matching retained request receipt/hash.",
      );
    const settlements = settlementsByTurn.get(turn.id) ?? [];
    if (
      settlements.length !==
      (turn.status === "completed" &&
      !["usage_unknown", "usage_invalid"].includes(attempt?.billingState ?? "")
        ? 1
        : 0)
    )
      issue(
        "turn_settlement_count",
        ref,
        `Found ${settlements.length} settlements for ${turn.status}.`,
      );
    if (
      !amount(turn.chargedCredits, ref).eq(
        consumedByTurn.get(turn.id) ?? zero(),
      )
    )
      issue(
        "turn_charge_mismatch",
        ref,
        "chargedCredits differs from chat ledger consumption.",
      );
  }
  for (const [turnId, settlements] of settlementsByTurn) {
    if (settlements.length > 1)
      issue(
        "multiple_turn_settlements",
        `turn:${turnId}`,
        "A turn may consume credits at most once, across retries.",
      );
  }

  const managedUsages = new Map<string, ChatLedgerAuditInput["usages"]>();
  let legacyChatUsageIgnored = 0;
  for (const usage of input.usages) {
    if (
      usage.action !== "conversation.chat" &&
      !usage.id.startsWith("chat_settle_")
    )
      continue;
    if (usage.action !== "conversation.chat")
      issue(
        "usage_action_mismatch",
        `usage:${usage.id}`,
        "Managed settlement usage must use action conversation.chat.",
      );
    const metadata = metadataObject(usage.metadata);
    const turnId = usage.id.startsWith("chat_settle_")
      ? usage.id.slice("chat_settle_".length)
      : typeof metadata.turnId === "string"
        ? metadata.turnId
        : null;
    if (!turnId) {
      legacyChatUsageIgnored += 1;
      continue;
    }
    append(managedUsages, turnId, usage);
    const settlements = settlementsByTurn.get(turnId) ?? [];
    const billing = metadataObject(metadataObject(metadata.usage).billing);
    const unknownAttempt =
      typeof metadata.attemptId === "string"
        ? attempts.get(metadata.attemptId)
        : undefined;
    const unknownClose =
      typeof metadata.attemptId === "string"
        ? (closeByAttempt.get(metadata.attemptId) ?? []).find(
            (row) =>
              row.userId === usage.userId &&
              row.turnId === turnId &&
              row.kind === "chat.release" &&
              billingResult(row).state === billing.state,
          )
        : undefined;
    const unknown =
      ["usage_unknown", "usage_invalid"].includes(String(billing.state)) &&
      unknownClose &&
      (!unknownAttempt || unknownAttempt.billingState === billing.state) &&
      amount(usage.creditsDelta, `usage:${usage.id}`).isZero();
    if (settlements.length !== 1 && !unknown)
      issue("usage_without_settlement", `usage:${usage.id}`, turnId);
    if (
      usage.id !== `chat_settle_${turnId}` ||
      (metadata.turnId !== undefined && metadata.turnId !== turnId)
    )
      issue("usage_key_mismatch", `usage:${usage.id}`, turnId);
  }
  for (const attempt of input.attempts)
    if (
      ["usage_unknown", "usage_invalid"].includes(attempt.billingState) &&
      (managedUsages.get(attempt.turnId) ?? []).length !== 1
    )
      issue(
        "unknown_usage_log_count",
        `attempt:${attempt.id}`,
        "Unknown usage requires one explicit zero-charge UsageLog.",
      );
  for (const [turnId, settlements] of settlementsByTurn) {
    const usages = managedUsages.get(turnId) ?? [];
    if (usages.length !== 1)
      issue(
        "settlement_usage_count",
        `turn:${turnId}`,
        `Expected one UsageLog, found ${usages.length}.`,
      );
    if (usages.length !== 1 || settlements.length !== 1) continue;
    const [usage] = usages;
    const [settlement] = settlements;
    const metadata = metadataObject(usage.metadata);
    if (
      usage.userId !== settlement.userId ||
      !amount(usage.creditsDelta, `usage:${usage.id}`).eq(
        amount(settlement.consumedDelta, `entry:${settlement.id}`).negated(),
      ) ||
      (metadata.attemptId !== undefined &&
        metadata.attemptId !== settlement.attemptId)
    )
      issue(
        "usage_amount_or_owner_mismatch",
        `usage:${usage.id}`,
        "Usage must equal settled consumption, for the same owner/attempt.",
      );
  }

  for (const row of input.messages ?? []) {
    const turn = row.chatTurnId ? turns.get(row.chatTurnId) : null;
    const attempt = row.chatAttemptId ? attempts.get(row.chatAttemptId) : null;
    if (
      (row.chatTurnId && !turn) ||
      (row.chatAttemptId && !attempt) ||
      (turn && turn.conversationId !== row.conversationId) ||
      (attempt && attempt.turnId !== row.chatTurnId)
    )
      issue(
        "orphan_message_reference",
        `message:${row.id}`,
        "Chat message references do not resolve to the same conversation/turn.",
      );
  }
  for (const row of input.events ?? []) {
    if (
      !turns.has(row.turnId) ||
      attempts.get(row.attemptId)?.turnId !== row.turnId
    )
      issue(
        "orphan_event_reference",
        `event:${row.id}`,
        "Event references do not resolve to the same turn.",
      );
  }

  const userHolds = [
    ...new Set([...heldByUser.keys(), ...reservedByUser.keys()]),
  ]
    .sort()
    .map((userId) => {
      const held = heldByUser.get(userId) ?? zero();
      const reserved = reservedByUser.get(userId) ?? zero();
      if (!held.eq(reserved))
        issue(
          "aggregate_hold_mismatch",
          `user:${userId}`,
          `Ledger held ${held.toFixed(6)}; reserved attempts ${reserved.toFixed(6)}.`,
        );
      return {
        userId,
        ledgerHeld: held.toFixed(6),
        attemptReserved: reserved.toFixed(6),
      };
    });
  const counts = {
    queued: input.attempts.filter((row) => row.status === "queued").length,
    running: input.attempts.filter((row) => row.status === "running").length,
    reserved: input.attempts.filter((row) => row.billingState === "reserved")
      .length,
    active: input.turns.filter((row) => row.activeConversationId !== null)
      .length,
  };
  return {
    scope: "chat-only" as const,
    clean: issueCount === 0,
    quiescent: Object.values(counts).every((count) => count === 0),
    counts,
    totals: {
      ledgerHeld: [...heldByUser.values()]
        .reduce((sum, value) => sum.plus(value), zero())
        .toFixed(6),
      attemptReserved: [...reservedByUser.values()]
        .reduce((sum, value) => sum.plus(value), zero())
        .toFixed(6),
      consumed: [...consumedByTurn.values()]
        .reduce((sum, value) => sum.plus(value), zero())
        .toFixed(6),
    },
    legacyChatUsageIgnored,
    userHolds,
    issueCount,
    issueCounts,
    issues,
    issuesTruncated: issues.length < issueCount,
  };
}
