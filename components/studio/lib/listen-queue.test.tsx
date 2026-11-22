import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LISTEN_IDLE_MS, useListenQueue } from "./listen-queue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Props = Parameters<typeof useListenQueue>[0];
const setup = (overrides: Partial<Props> = {}) => {
  const flush = vi.fn(async (_content: string) => true);
  const hook = renderHook((props: Props) => useListenQueue(props), {
    initialProps: {
      enabled: true,
      busy: false,
      draft: "",
      conversationKey: "c1",
      flush,
      ...overrides,
    },
  });
  return { ...hook, flush };
};

it("sends lines said in a row as one message after a pause", async () => {
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

it("waits while the user is still typing or a reply is in flight", async () => {
  const { result, flush, rerender } = setup();
  const props = (patch: Partial<Props>): Props => ({
    enabled: true,
    busy: false,
    draft: "",
    conversationKey: "c1",
    flush,
    ...patch,
  });
  act(() => result.current.push("第一句"));
  rerender(props({ busy: true }));
  act(() => vi.advanceTimersByTime(LISTEN_IDLE_MS * 3));
  expect(flush).not.toHaveBeenCalled();
  rerender(props({ draft: "还在打" }));
  act(() => vi.advanceTimersByTime(LISTEN_IDLE_MS - 100));
  expect(flush).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(200));
  expect(flush).toHaveBeenCalledWith("第一句");
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
  const { result, flush, rerender } = setup();
  act(() => result.current.push("留着"));
  rerender({ enabled: true, busy: false, draft: "", conversationKey: "c2", flush });
  expect(result.current.lines).toEqual([]);
  act(() => result.current.push("马上发"));
  rerender({ enabled: false, busy: false, draft: "", conversationKey: "c2", flush });
  await act(async () => vi.advanceTimersByTime(0));
  expect(flush).toHaveBeenCalledWith("马上发");
});
