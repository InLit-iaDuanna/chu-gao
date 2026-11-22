import { expect, it } from "vitest";

import {
  LISTEN_REACT_PROMPT,
  parseReaction,
  reactMessages,
} from "./chat-listen-react";

it("reads the reaction word and a short murmur", () => {
  expect(parseReaction("nod 嗯嗯")).toEqual({ reaction: "nod", line: "嗯嗯" });
  expect(parseReaction("care：辛苦了")).toEqual({ reaction: "care", line: "辛苦了" });
  expect(parseReaction("Curious “然后呢？”")).toEqual({
    reaction: "curious",
    line: "然后呢？",
  });
  expect(parseReaction("listen")).toEqual({ reaction: "listen", line: null });
  expect(parseReaction("**wow**")).toEqual({ reaction: "wow", line: null });
});

it("treats anything unusable as quiet listening", () => {
  expect(parseReaction("")).toEqual({ reaction: "listen", line: null });
  expect(parseReaction("嗯嗯我在听")).toEqual({ reaction: "listen", line: null });
  expect(parseReaction("smile 哈哈")).toEqual({ reaction: "listen", line: null });
  // Too long to be a murmur, or not one at all: keep the nod, drop the words.
  expect(parseReaction("care 你一定很难过吧，我理解你")).toEqual({
    reaction: "care",
    line: null,
  });
  expect(parseReaction("nod ……")).toEqual({ reaction: "nod", line: null });
  expect(parseReaction("nod listen")).toEqual({ reaction: "nod", line: null });
});

it("shows Flash the earlier talk and puts the newest line last", () => {
  const [system, user] = reactMessages(
    [
      { role: "USER", content: "今天去面试了" },
      { role: "ASSISTANT", content: "[[listening]]" },
    ],
    ["面试官人挺好", "  ", "但是最后一轮没过"],
  );
  expect(system).toEqual({ role: "system", content: LISTEN_REACT_PROMPT });
  expect(user.role).toBe("user");
  expect(user.content).toContain("他：今天去面试了");
  expect(user.content).toContain("你：（安静地听着）");
  expect(user.content).toContain("这一段他已经说了：\n面试官人挺好");
  expect(user.content.endsWith("他刚说的这一句：但是最后一轮没过")).toBe(true);
});

it("tells Flash what it already murmured in this stretch", () => {
  const [, user] = reactMessages([], ["加班到十点", "地铁上差点睡着"], ["辛苦了"]);
  expect(user.content).toContain("这一段你已经出过声：辛苦了");
  expect(user.content.endsWith("他刚说的这一句：地铁上差点睡着")).toBe(true);
});

it("works for the very first line of a new conversation", () => {
  const [, user] = reactMessages([], ["我好紧张"]);
  expect(user.content).toBe("他刚说的这一句：我好紧张");
});
