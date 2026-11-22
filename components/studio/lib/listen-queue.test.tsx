import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  LISTEN_IDLE_MS,
  LISTEN_STALL_MS,
  useListenQueue,
} from "./listen-queue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Props = Parameters<typeof useListenQueue>[0];
const setup = () => {
  const flush = vi.fn(async (_content: string) => true);
  const onNudge = vi.fn();
  const base: Props = {
    enabled: true,
    busy: false,
    draft: "",
    conversationKey: "c1",
    flush,
    onNudge,
  };
  const hook = renderHook((props: Props) => useListenQueue(props), {
    initialProps: base,
  });
  const set = (patch: Partial<Props>) => hook.rerender({ ...base, ...patch });
  return { ...hook, flush, onNudge, set };
};

it("sends lines said in a row as one message once the box is empty and still", async () => {
  const { result, flush } = setup();
  act(() => result.current.push("今天好累"));
  act(() => vi.advanceTimersByTime(1_000));
  act(() => result.current.push("开了三个会"));
  expect(result.current.lines).toEqual(["今天好累", "开了三个会"]);
  expect(result.current.talking).toBe(true);
  act(() => vi.advanceTimersByTime(LISTEN_IDLE_MS - 10));
  expect(flush).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(20));
  expect(flush).toHaveBeenCalledWith("今天好累\n开了三个会");
  expect(result.current.lines).toEqual([]);
});

it("never sends while something is in the box or a reply is in flight", async () => {
  const { result, flush, set } = setup();
  act(() => result.current.push("第一句"));
  set({ busy: true });
  act(() => vi.advanceTimersByTime(LISTEN_IDLE_MS * 3));
  set({ draft: "还在打" });
  act(() => vi.advanceTimersByTime(LISTEN_IDLE_MS * 3));
  expect(flush).not.toHaveBeenCalled();
  set({ draft: "" });
  act(() => vi.advanceTimersByTime(LISTEN_IDLE_MS - 100));
  expect(flush).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(200));
  expect(flush).toHaveBeenCalledWith("第一句");
});

it("speaks up once when text sits untouched in the box", () => {
  const { result, onNudge, set } = setup();
  set({ draft: "其实我" });
  act(() => vi.advanceTimersByTime(LISTEN_STALL_MS - 100));
  expect(onNudge).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(200));
  expect(onNudge).toHaveBeenCalledWith("stalled");
  set({ draft: "其实我想" });
  act(() => vi.advanceTimersByTime(LISTEN_STALL_MS * 2));
  expect(onNudge).toHaveBeenCalledTimes(1);
  // A sent line starts a new stretch of talk.
  act(() => result.current.push("其实我想换工作"));
  set({ draft: "但是" });
  act(() => vi.advanceTimersByTime(LISTEN_STALL_MS));
  expect(onNudge).toHaveBeenCalledTimes(2);
});

it("does not count steady typing as hesitating, but does count rewriting", () => {
  const { onNudge, set } = setup();
  let text = "";
  for (const char of "我觉得这件事情其实也没有那么糟糕吧") {
    text += char;
    set({ draft: text });
    act(() => vi.advanceTimersByTime(3_000));
  }
  expect(onNudge).not.toHaveBeenCalled();
  for (let round = 0; round < 3; round++) {
    set({ draft: text.slice(0, -6) });
    set({ draft: text.slice(0, -6) + "换个说法" });
  }
  expect(onNudge).toHaveBeenCalledWith("rewriting");
});

it("puts a refused batch back and holds it until the user speaks again", async () => {
  const { result, flush } = setup();
  flush.mockResolvedValueOnce(false);
  act(() => result.current.push("一"));
  await act(async () => vi.advanceTimersByTime(LISTEN_IDLE_MS));
  expect(result.current.lines).toEqual(["一"]);
  await act(async () => vi.advanceTimersByTime(LISTEN_IDLE_MS * 3));
  expect(flush).toHaveBeenCalledTimes(1);
  act(() => result.current.push("二"));
  await act(async () => vi.advanceTimersByTime(LISTEN_IDLE_MS));
  expect(flush).toHaveBeenLastCalledWith("一\n二");
});

it("sends at once when leaving 倾听 and drops lines on switching threads", async () => {
  const { result, flush, set } = setup();
  act(() => result.current.push("留着"));
  set({ conversationKey: "c2" });
  expect(result.current.lines).toEqual([]);
  act(() => result.current.push("马上发"));
  set({ conversationKey: "c2", enabled: false });
  await act(async () => vi.advanceTimersByTime(0));
  expect(flush).toHaveBeenCalledWith("马上发");
});
