import { expect, it } from "vitest";

import {
  LISTEN_NUDGE_PROMPT,
  NUDGE_MAX_CHARS,
  cleanNudge,
  nudgeHistory,
  nudgeInstruction,
} from "./chat-listen-nudge";

it("feeds only sent messages, opening with the user, silences spelled out", () => {
  const history = nudgeHistory([
    { role: "ASSISTANT", content: "你好" },
    { role: "USER", content: "今天好累" },
    { role: "ASSISTANT", content: "[[listening]]" },
    { role: "USER", content: "x".repeat(900) },
  ]);
  expect(history[0]).toEqual({ role: "user", content: "今天好累" });
  expect(history[1].content).toBe("（安静地听着，没有开口）");
  expect(String(history[2].content).length).toBeLessThan(700);
});

it("keeps one short clean line", () => {
  expect(cleanNudge("“不用想好再说，说一半也行。”\n第二行")).toBe(
    "不用想好再说，说一半也行。",
  );
  expect(cleanNudge("[[listening]]")).toBeNull();
  expect(cleanNudge("长".repeat(80))!.length).toBe(NUDGE_MAX_CHARS + 1);
});

it("tells the model it cannot see the draft and names the hesitation", () => {
  expect(LISTEN_NUDGE_PROMPT).toContain("你看不到他正在写什么");
  expect(nudgeInstruction("rewriting")).toContain("写了又删");
  expect(nudgeInstruction("stalled")).toContain("半分钟");
});
