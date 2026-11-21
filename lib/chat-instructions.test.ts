import { afterEach, expect, it, vi } from "vitest";
import {
  CHAT_AGENT_TOOLS_CONTRACT,
  chatSystemInstructions,
  chatTimeInstruction,
  chatTurnInstructions,
} from "@/lib/chat-instructions";

it("describes the agent tools in turn instructions, before the search section", () => {
  const instructions = chatTurnInstructions("base", false);
  for (const name of [
    "ask_user",
    "suggest_replies",
    "read_url",
    "check_credits",
    "source_images",
    "[本条回复生成的图片]",
  ])
    expect(instructions).toContain(name);
  expect(instructions.indexOf(CHAT_AGENT_TOOLS_CONTRACT)).toBeLessThan(
    instructions.indexOf("## 联网搜索"),
  );
  // Same prefix whichever search variant the turn uses (prompt cache).
  const searching = chatTurnInstructions("base", true, true);
  const prefix = instructions.slice(0, instructions.indexOf("## 联网搜索"));
  expect(searching.startsWith(prefix)).toBe(true);
  expect(chatSystemInstructions("base", false, false)).not.toContain(
    "ask_user",
  );
});

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
