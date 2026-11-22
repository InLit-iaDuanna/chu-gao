import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { XIIE_POSES } from "./xiie-art";
import { Xiie } from "./Xiie";
import { TurnXiie, turnPose } from "./TurnXiie";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const pose = (root: HTMLElement) =>
  root.querySelector("svg[data-pose]")?.getAttribute("data-pose") ?? null;

it("gives every stage of a turn its own pose", () => {
  const running = (activity?: string, hasText = false) =>
    turnPose({ status: "running", activity, hasText });
  expect(turnPose({ status: "queued", activity: "queued" })).toBe("running");
  expect(running("context")).toBe("reading");
  expect(running("preparing_context")).toBe("reading");
  expect(running("waiting_upstream")).toBe("thinking");
  expect(running("reasoning")).toBe("focus");
  expect(running("searching")).toBe("reading");
  expect(running("image_tool")).toBe("idea");
  expect(running("image_generating")).toBe("building");
  expect(running("answering")).toBe("coding");
  expect(running("retrying")).toBe("debugging");
  expect(running(undefined)).toBe("thinking");
  expect(running(undefined, true)).toBe("coding");
  expect(
    turnPose({ status: "running", activity: "answering", connection: "reconnecting" }),
  ).toBe("debugging");
  expect(
    turnPose({ status: "running", activity: "answering", connection: "disconnected" }),
  ).toBe("sleeping");
});

it("draws every pose", () => {
  for (const name of XIIE_POSES) {
    const view = render(<Xiie pose={name} at={0} />);
    expect(view.container.querySelectorAll("path").length).toBeGreaterThan(3);
    expect(view.container.querySelectorAll("[data-eye]")).toHaveLength(2);
    view.unmount();
  }
});

it("cheers when the turn it watched finishes, then sinks away", () => {
  const turn = (active: boolean, status: string, activity?: string) => (
    <TurnXiie
      active={active}
      status={status}
      activity={activity}
      hasText={status === "completed"}
      latest
    />
  );
  const view = render(turn(true, "running", "reasoning"));
  expect(pose(view.container)).toBe("focus");
  view.rerender(turn(true, "running", "answering"));
  expect(pose(view.container)).toBe("coding");
  view.rerender(turn(false, "completed"));
  expect(pose(view.container)).toBe("done");
  act(() => void vi.advanceTimersByTime(2_700));
  // Still drawn while the slot closes, then gone.
  expect(pose(view.container)).toBe("done");
  act(() => void vi.advanceTimersByTime(400));
  expect(pose(view.container)).toBeNull();
});

it("stays out of replies that were already finished", () => {
  const view = render(
    <TurnXiie active={false} status="completed" hasText latest />,
  );
  expect(pose(view.container)).toBeNull();
});

it("worries over the latest reply if it broke off, but not over a cancelled one", () => {
  const view = render(
    <TurnXiie active={false} status="interrupted" hasText latest />,
  );
  expect(pose(view.container)).toBe("debugging");
  view.rerender(
    <TurnXiie active={false} status="interrupted" hasText latest={false} />,
  );
  act(() => void vi.advanceTimersByTime(400));
  expect(pose(view.container)).toBeNull();
  view.rerender(<TurnXiie active={false} status="cancelled" hasText latest />);
  expect(pose(view.container)).toBeNull();
});

it("answers a poke with a heart, and tells its owner", () => {
  const onPoke = vi.fn();
  const view = render(<Xiie pose="idea" onPoke={onPoke} />);
  const svg = view.container.querySelector("svg")!;
  const before = svg.querySelectorAll("path").length;
  fireEvent.click(svg);
  expect(onPoke).toHaveBeenCalledTimes(1);
  expect(svg.querySelectorAll("path").length).toBe(before + 1);
});

it("plays a reaction once per cue: a mark floats up, a nod adds none", () => {
  const view = render(<Xiie pose="focus" />);
  const svg = view.container.querySelector("svg")!;
  const before = svg.querySelectorAll("path").length;
  view.rerender(<Xiie pose="focus" cue={{ id: 1, kind: "heart" }} />);
  expect(svg.querySelectorAll("path").length).toBe(before + 1);
  // The same cue again does not play twice.
  view.rerender(<Xiie pose="focus" cue={{ id: 1, kind: "heart" }} />);
  expect(svg.querySelectorAll("path").length).toBe(before + 1);
  view.rerender(<Xiie pose="focus" cue={{ id: 2, kind: "nod" }} />);
  expect(svg.querySelectorAll("path").length).toBe(before + 1);
  view.rerender(<Xiie pose="focus" cue={{ id: 3, kind: "ask" }} />);
  expect(svg.querySelectorAll("path").length).toBe(before + 2);
});
