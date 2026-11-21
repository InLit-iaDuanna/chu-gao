import { describe, expect, it } from "vitest";
import {
  conversationModeInstruction,
  isListenSilence,
  latestMessageSuffix,
  LISTEN_SILENCE_MARKER,
  LISTEN_SILENCE_STREAK_MAX,
  normalizeConversationMode,
  normalizeListenReply,
  trailingSilenceStreak,
} from "./chat-conversation-mode";
import { parseInteractiveBlocks } from "@/components/studio/lib/chat-interactive-blocks";

describe("conversation modes", () => {
  it("defaults unknown values to detail, which adds nothing", () => {
    expect(normalizeConversationMode(undefined)).toBe("detail");
    expect(normalizeConversationMode("chatty")).toBe("detail");
    expect(conversationModeInstruction("detail")).toBe("");
    expect(latestMessageSuffix({ modeInstruction: "", runtimeTime: "T" })).toBe(
      "\n\n[本轮运行时间]\nT",
    );
  });

  it("puts the mode block before the runtime clock", () => {
    const suffix = latestMessageSuffix({
      modeInstruction: conversationModeInstruction("dialogue"),
      runtimeTime: "T",
    });
    expect(suffix.startsWith("\n\n[本轮对话模式：对谈]")).toBe(true);
    expect(suffix.endsWith("[本轮运行时间]\nT")).toBe(true);
  });

  it("listen mode allows silence and forces a recap after a long one", () => {
    const quiet = conversationModeInstruction("listen", { silenceStreak: 1 });
    expect(quiet).toContain(LISTEN_SILENCE_MARKER);
    expect(quiet).not.toContain("必须开口");
    expect(
      conversationModeInstruction("listen", {
        silenceStreak: LISTEN_SILENCE_STREAK_MAX,
      }),
    ).toContain("必须开口");
  });

  it("counts trailing silences only", () => {
    expect(
      trailingSilenceStreak([
        LISTEN_SILENCE_MARKER,
        ` ${LISTEN_SILENCE_MARKER}\n`,
        "说得对",
        LISTEN_SILENCE_MARKER,
      ]),
    ).toBe(2);
    expect(trailingSilenceStreak(["嗯", LISTEN_SILENCE_MARKER])).toBe(0);
  });

  it("keeps real words when the marker leaks into a reply", () => {
    expect(normalizeListenReply(`${LISTEN_SILENCE_MARKER}`)).toBe(
      LISTEN_SILENCE_MARKER,
    );
    expect(normalizeListenReply(`我在听。${LISTEN_SILENCE_MARKER}`)).toBe(
      "我在听。",
    );
    expect(isListenSilence(normalizeListenReply(" [[listening]] "))).toBe(true);
  });

  it("renders a silent reply as listening and hides the marker while typed", () => {
    expect(parseInteractiveBlocks(LISTEN_SILENCE_MARKER)).toEqual({
      body: "",
      incomplete: false,
      listening: true,
    });
    expect(parseInteractiveBlocks("[[list", { streaming: true }).body).toBe("");
    expect(parseInteractiveBlocks("[[链接]]", { streaming: true }).body).toBe(
      "[[链接]]",
    );
  });
});
