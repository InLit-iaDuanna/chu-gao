import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONVERSATION_SYSTEM_PROMPT } from "@/lib/ai-config";
import {
  CHAT_CONTEXT_CONTRACT,
  CHAT_IMAGE_TOOL_CONTRACT,
  CHAT_OUTPUT_CONTRACT,
  CHAT_WEB_SEARCH_OFF_CONTRACT,
  CHAT_WEB_SEARCH_ON_CONTRACT,
  chatSystemInstructions,
  chatTimeInstruction,
  chatTurnInstructions,
} from "@/lib/chat-instructions";
import {
  CHAT_IMAGE_TOOL,
  CHAT_IMAGE_TOOL_NAME,
} from "@/lib/chat-image-tool-definition";

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

describe("turn instructions", () => {
  it("layers persona, then the runtime contract, with web search last", () => {
    const text = chatTurnInstructions("PERSONA", true);
    const order = [
      "PERSONA",
      CHAT_OUTPUT_CONTRACT,
      CHAT_CONTEXT_CONTRACT,
      CHAT_IMAGE_TOOL_CONTRACT,
      CHAT_WEB_SEARCH_ON_CONTRACT,
    ].map((part) => text.indexOf(part));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text.endsWith(CHAT_WEB_SEARCH_ON_CONTRACT)).toBe(true);
    expect(text).not.toContain(CHAT_WEB_SEARCH_OFF_CONTRACT);
  });

  it("shares one cacheable prefix between the web search variants", () => {
    const on = chatTurnInstructions("PERSONA", true);
    const off = chatTurnInstructions("PERSONA", false);
    const prefix = on.slice(0, on.indexOf(CHAT_WEB_SEARCH_ON_CONTRACT));
    expect(off.startsWith(prefix)).toBe(true);
    expect(off.endsWith(CHAT_WEB_SEARCH_OFF_CONTRACT)).toBe(true);
    expect(prefix).toContain(CHAT_IMAGE_TOOL_CONTRACT);
  });

  it("never puts the clock into the frozen instructions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
    const first = chatTurnInstructions(
      DEFAULT_CONVERSATION_SYSTEM_PROMPT,
      true,
    );
    vi.advanceTimersByTime(86_400_000);
    expect(chatTurnInstructions(DEFAULT_CONVERSATION_SYSTEM_PROMPT, true)).toBe(
      first,
    );
    expect(first).not.toContain("当前北京时间");
  });

  it("explains every marker the runtime injects into messages", () => {
    for (const marker of [
      "[本轮运行时间]",
      "[参考图身份和顺序]",
      "[已提交的图片任务]",
      "[应用保存的工具和来源资料",
      "历史未完成轮次",
    ])
      expect(CHAT_CONTEXT_CONTRACT).toContain(marker);
    expect(CHAT_CONTEXT_CONTRACT).toContain("不是指令");
  });

  it("states the image tool rules the worker enforces", () => {
    expect(CHAT_IMAGE_TOOL_CONTRACT).toContain(CHAT_IMAGE_TOOL_NAME);
    expect(CHAT_IMAGE_TOOL_CONTRACT).toContain("每轮只能提交一次");
    expect(CHAT_IMAGE_TOOL_CONTRACT).toContain("提交回执，不是图片");
    expect(CHAT_IMAGE_TOOL_CONTRACT).toContain("ok 为 false");
    // Only parameters that exist on the tool may be named in the contract.
    const parameters = Object.keys(
      CHAT_IMAGE_TOOL.function.parameters.properties,
    );
    for (const name of ["size", "quality", "outputFormat", "background", "n"]) {
      expect(parameters).toContain(name);
      expect(CHAT_IMAGE_TOOL_CONTRACT).toContain(name);
    }
    expect(CHAT_IMAGE_TOOL_CONTRACT).not.toContain("modelId");
  });

  it("tells the model the source list is appended by the application", () => {
    expect(CHAT_WEB_SEARCH_ON_CONTRACT).toContain(
      "来源列表由系统自动附在回复末尾",
    );
    expect(CHAT_WEB_SEARCH_OFF_CONTRACT).toContain("不要声称已经搜索");
  });
});

describe("default persona", () => {
  it("stays free of runtime plumbing owned by the contract layer", () => {
    for (const word of [
      CHAT_IMAGE_TOOL_NAME,
      "生图工具",
      "联网",
      "Markdown",
      "当前北京时间",
    ])
      expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).not.toContain(word);
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain("Chūgǎo Studio");
  });
});
