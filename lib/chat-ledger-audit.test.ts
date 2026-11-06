// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  auditChatLedger,
  type ChatLedgerAuditInput,
} from "./chat-ledger-audit";

function fixture(): ChatLedgerAuditInput {
  return {
    users: [{ id: "user" }],
    conversations: [{ id: "conversation", userId: "user" }],
    turns: [
      {
        id: "turn",
        userId: "user",
        conversationId: "conversation",
        clientRequestId: "request",
        inputHash: "hash",
        status: "completed",
        activeConversationId: null,
        activeAttemptId: "attempt",
        chargedCredits: 0.2,
      },
    ],
    attempts: [
      {
        id: "attempt",
        turnId: "turn",
        status: "completed",
        billingState: "charged",
        heldCredits: 0.2,
      },
    ],
    entries: [
      {
        id: "reserve",
        operationKey: "reserve:attempt",
        kind: "chat.reserve",
        userId: "user",
        turnId: "turn",
        attemptId: "attempt",
        turnSettlementKey: null,
        availableDelta: "-0.200000",
        heldDelta: "0.200000",
        consumedDelta: "0",
      },
      {
        id: "close",
        operationKey: "close:attempt",
        kind: "chat.settle",
        userId: "user",
        turnId: "turn",
        attemptId: "attempt",
        turnSettlementKey: "settle:turn",
        availableDelta: "0",
        heldDelta: "-0.200000",
        consumedDelta: "0.200000",
      },
    ],
    receipts: [
      {
        id: "receipt",
        userId: "user",
        scope: "create",
        clientRequestId: "request",
        inputHash: "hash",
        conversationId: "conversation",
        turnId: "turn",
        attemptId: "attempt",
        contentClearedAt: null,
      },
    ],
    usages: [
      {
        id: "chat_settle_turn",
        userId: "user",
        action: "conversation.chat",
        creditsDelta: -0.2,
        metadata: { turnId: "turn", attemptId: "attempt" },
      },
    ],
    messages: [
      {
        id: "message",
        conversationId: "conversation",
        chatTurnId: "turn",
        chatAttemptId: "attempt",
      },
    ],
    events: [{ id: "event", turnId: "turn", attemptId: "attempt" }],
  };
}

function reserve(input: ChatLedgerAuditInput) {
  Object.assign(input.turns[0], {
    status: "queued",
    activeConversationId: "conversation",
    chargedCredits: 0,
  });
  Object.assign(input.attempts[0], {
    status: "queued",
    billingState: "reserved",
  });
  input.entries.pop();
  input.usages = [];
  return input;
}

describe("chat-only ledger audit", () => {
  it("accepts one settlement and a retained terminal activeAttemptId", () => {
    expect(auditChatLedger(fixture())).toMatchObject({
      scope: "chat-only",
      clean: true,
      quiescent: true,
      counts: { queued: 0, running: 0, reserved: 0, active: 0 },
      totals: {
        ledgerHeld: "0.000000",
        attemptReserved: "0.000000",
        consumed: "0.200000",
      },
    });
  });

  it("keeps a valid open hold clean, but blocks a drained result", () => {
    expect(auditChatLedger(reserve(fixture()))).toMatchObject({
      clean: true,
      quiescent: false,
      counts: { queued: 1, running: 0, reserved: 1, active: 1 },
      totals: { ledgerHeld: "0.200000", attemptReserved: "0.200000" },
    });
  });

  it("does not count heldCredits retained on a released terminal attempt", () => {
    const input = fixture();
    Object.assign(input.turns[0], { status: "cancelled", chargedCredits: 0 });
    Object.assign(input.attempts[0], {
      status: "cancelled",
      billingState: "released",
    });
    Object.assign(input.entries[1], {
      kind: "chat.release",
      turnSettlementKey: null,
      availableDelta: "0.2",
      consumedDelta: "0",
    });
    input.usages = [];
    expect(auditChatLedger(input)).toMatchObject({
      clean: true,
      quiescent: true,
      totals: { attemptReserved: "0.000000" },
    });
  });

  it("sums six-decimal fractional holds without floating point drift", () => {
    const input = reserve(fixture());
    input.attempts[0].heldCredits = 0.1 + 0.2;
    Object.assign(input.entries[0], {
      availableDelta: "-0.300000",
      heldDelta: "0.300000",
    });
    expect(auditChatLedger(input)).toMatchObject({
      clean: true,
      totals: { ledgerHeld: "0.300000", attemptReserved: "0.300000" },
    });
  });

  it("accepts a zero-price completed turn with its unique settlement and UsageLog", () => {
    const input = fixture();
    input.turns[0].chargedCredits = 0;
    input.attempts[0].heldCredits = 0;
    input.usages[0].creditsDelta = 0;
    input.entries.forEach((entry) =>
      Object.assign(entry, {
        availableDelta: 0,
        heldDelta: 0,
        consumedDelta: 0,
      }),
    );
    expect(auditChatLedger(input).clean).toBe(true);
  });

  it("accepts retained closed ledger and usage after tombstoned content deletion", () => {
    const input = fixture();
    input.receipts[0].contentClearedAt = new Date("2026-10-18T00:00:00Z");
    input.turns = [];
    input.attempts = [];
    input.conversations = [];
    input.messages = [];
    input.events = [];
    expect(auditChatLedger(input)).toMatchObject({
      clean: true,
      quiescent: true,
    });
  });

  it("rejects deleted content without a tombstone", () => {
    const input = fixture();
    input.turns = [];
    input.attempts = [];
    input.messages = [];
    input.events = [];
    const result = auditChatLedger(input);
    expect(result.issueCounts.orphan_ledger_reference).toBe(2);
    expect(result.issueCounts.orphan_receipt_reference).toBe(1);
  });

  it("does not use a tombstone to excuse a dangling attempt on existing content", () => {
    const input = fixture();
    input.receipts[0].contentClearedAt = new Date();
    input.attempts = [];
    expect(auditChatLedger(input).issueCounts.orphan_ledger_reference).toBe(2);
  });

  it("checks reserve/close identity even when both referenced turns were cleared", () => {
    const input = fixture();
    input.receipts[0].contentClearedAt = new Date();
    input.receipts.push({
      ...input.receipts[0],
      id: "other-receipt",
      clientRequestId: "other-request",
      turnId: "other",
    });
    Object.assign(input.entries[1], {
      turnId: "other",
      turnSettlementKey: "settle:other",
    });
    Object.assign(input.usages[0], {
      id: "chat_settle_other",
      metadata: { turnId: "other", attemptId: "attempt" },
    });
    input.turns = [];
    input.attempts = [];
    input.conversations = [];
    input.messages = [];
    input.events = [];
    expect(
      auditChatLedger(input).issueCounts.close_reserve_reference_mismatch,
    ).toBe(1);
  });

  it("never hides an unclosed hold behind a content tombstone", () => {
    const input = reserve(fixture());
    input.receipts[0].contentClearedAt = new Date();
    input.turns = [];
    input.attempts = [];
    input.messages = [];
    input.events = [];
    expect(auditChatLedger(input).issueCounts).toMatchObject({
      deleted_attempt_hold: 1,
      aggregate_hold_mismatch: 1,
    });
  });

  it("detects duplicate reserve/close and settlement keys", () => {
    const input = fixture();
    input.entries.push(
      ...input.entries.map((entry) => ({
        ...entry,
        id: `${entry.id}-duplicate`,
      })),
    );
    expect(auditChatLedger(input).issueCounts).toMatchObject({
      duplicate_operation_key: 2,
      duplicate_settlement_key: 1,
      reserve_count: 1,
      close_count: 1,
      multiple_turn_settlements: 1,
    });
  });

  it("checks canonical operation/turn settlement keys and kind", () => {
    const input = fixture();
    input.entries[0].operationKey = "reserve:other";
    input.entries[1].turnSettlementKey = "settle:other";
    expect(auditChatLedger(input).issueCounts).toMatchObject({
      invalid_operation_key: 1,
      invalid_settlement: 1,
    });
    input.entries[0].operationKey = "reserve:attempt";
    input.entries[0].kind = "chat.release";
    expect(auditChatLedger(input).issueCounts.invalid_reserve).toBe(1);
  });

  it("detects unbalanced entries and aggregate held vs reserved mismatch", () => {
    const input = reserve(fixture());
    input.entries[0].heldDelta = "0.1";
    expect(auditChatLedger(input).issueCounts).toMatchObject({
      unbalanced_entry: 1,
      hold_amount_mismatch: 1,
      aggregate_hold_mismatch: 1,
    });
  });

  it("requires exactly one matching usage entry for each settlement", () => {
    const input = fixture();
    input.usages = [];
    expect(auditChatLedger(input).issueCounts.settlement_usage_count).toBe(1);
    input.usages = [
      {
        id: "chat_settle_other",
        userId: "user",
        action: "conversation.chat",
        creditsDelta: -0.3,
        metadata: null,
      },
    ];
    expect(auditChatLedger(input).issueCounts.usage_without_settlement).toBe(1);
    input.usages = fixture().usages;
    input.usages[0].creditsDelta = -0.4;
    expect(
      auditChatLedger(input).issueCounts.usage_amount_or_owner_mismatch,
    ).toBe(1);
  });

  it("does not turn legacy usage or admin adjustments into chat consumption", () => {
    const input = fixture();
    input.usages.push({
      id: "legacy",
      userId: "user",
      action: "conversation.chat",
      creditsDelta: -1,
      metadata: null,
    });
    input.entries.push({
      id: "admin",
      operationKey: "admin:actor:request",
      kind: "admin.adjust",
      userId: "user",
      turnId: null,
      attemptId: null,
      turnSettlementKey: null,
      availableDelta: 100,
      heldDelta: 0,
      consumedDelta: 0,
    });
    expect(auditChatLedger(input)).toMatchObject({
      clean: true,
      legacyChatUsageIgnored: 1,
      totals: { consumed: "0.200000" },
    });
  });

  it("checks orphan and cross-turn message/event/receipt references", () => {
    const input = fixture();
    input.messages![0].chatAttemptId = "absent";
    input.events![0].attemptId = "absent";
    input.receipts[0].attemptId = "absent";
    expect(auditChatLedger(input).issueCounts).toMatchObject({
      orphan_message_reference: 1,
      orphan_event_reference: 1,
      orphan_receipt_reference: 1,
    });
  });

  it("counts running/reserved/active independently and rejects malformed states", () => {
    const input = fixture();
    input.attempts[0].status = "running";
    input.attempts[0].billingState = "reserved";
    input.turns[0].activeConversationId = "conversation";
    const result = auditChatLedger(input);
    expect(result.counts).toEqual({
      queued: 0,
      running: 1,
      reserved: 1,
      active: 1,
    });
    expect(result.clean).toBe(false);
  });

  it("rejects invalid money and bounds issue details without losing the count", () => {
    const input = fixture();
    input.entries[0].heldDelta = "NaN";
    expect(auditChatLedger(input).issueCounts.invalid_amount).toBeGreaterThan(
      0,
    );
    input.events = Array.from({ length: 220 }, (_, i) => ({
      id: `${i}`,
      turnId: "absent",
      attemptId: "absent",
    }));
    const result = auditChatLedger(input);
    expect(result.issues).toHaveLength(200);
    expect(result.issueCount).toBeGreaterThan(220);
    expect(result.issuesTruncated).toBe(true);
  });
});
