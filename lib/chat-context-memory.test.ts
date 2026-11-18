import { describe, expect, it } from "vitest";

import {
  normalizeStructuredChatMemory,
  parseStructuredChatMemory,
  renderStructuredChatMemory,
} from "@/lib/chat-context-memory";

const memory = (patch: Record<string, unknown>) => ({
  version: 1,
  goals: [],
  facts: [],
  constraints: [],
  decisions: [],
  references: [],
  pending: [],
  ...patch,
});

describe("structured chat memory", () => {
  it("keeps only the newest six pending items so stale todos fall off", () => {
    const pending = Array.from({ length: 18 }, (_, index) => `待办 ${index + 1}`);
    const parsed = parseStructuredChatMemory(memory({ pending }));
    expect(parsed?.pending).toEqual(pending.slice(-6));
  });

  it("dedupes items that differ only by spacing or punctuation", () => {
    const parsed = parseStructuredChatMemory(
      memory({ facts: ["白色背景。", "白色 背景", "不要太卡通"] }),
    );
    expect(parsed?.facts).toEqual(["白色背景。", "不要太卡通"]);
  });

  it("caps references and truncates overlong items", () => {
    const references = Array.from({ length: 20 }, (_, index) => `图${index + 1}`);
    const parsed = parseStructuredChatMemory(
      memory({ references, decisions: ["长".repeat(500)] }),
    );
    expect(parsed?.references).toEqual(references.slice(-12));
    expect(parsed?.decisions[0]).toHaveLength(201);
  });

  it("applies the same caps when rendering an existing snapshot", () => {
    const pending = Array.from({ length: 10 }, (_, index) => `旧待办 ${index}`);
    const rendered = renderStructuredChatMemory(
      JSON.stringify(memory({ pending })),
    );
    expect(rendered).not.toContain("旧待办 3");
    expect(rendered).toContain("旧待办 9");
    expect(normalizeStructuredChatMemory("not json")).toBe("not json");
  });
});
