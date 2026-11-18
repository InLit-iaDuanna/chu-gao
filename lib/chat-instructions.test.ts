import { afterEach, expect, it, vi } from "vitest";
import {
  chatSystemInstructions,
  chatTimeInstruction,
} from "@/lib/chat-instructions";

afterEach(() => vi.useRealTimers());
it("keeps the cached instruction prefix stable across minutes while preserving an explicit current time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
  const stable = chatSystemInstructions("base", false, false);
  const time = chatTimeInstruction();
  expect(stable).not.toContain("当前北京时间");
  expect(time).toContain("18:00");
  vi.advanceTimersByTime(60000);
  expect(chatSystemInstructions("base", false, false)).toBe(stable);
  expect(chatTimeInstruction()).toContain("18:01");
  expect(chatSystemInstructions("base")).toContain("当前北京时间");
});
