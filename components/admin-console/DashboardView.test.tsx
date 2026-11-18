import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActivityPanel,
  chartTickIndices,
  chartYAxisTicks,
  normalizeDailySeries,
  normalizeHourlySeries,
} from "./DashboardView";

const observers: ResizeObserverStub[] = [];

class ResizeObserverStub implements ResizeObserver {
  target?: Element;
  disconnect = vi.fn();

  constructor(private callback: ResizeObserverCallback) {
    observers.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  unobserve() {}

  resize(width: number) {
    this.callback(
      [
        {
          target: this.target!,
          contentRect: new DOMRect(0, 0, width, 256),
        } as ResizeObserverEntry,
      ],
      this,
    );
  }
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => vi.unstubAllGlobals());

const now = new Date(2026, 10, 7, 12);
const daily = normalizeDailySeries(
  [{ date: "2026-11-07", total: 1, succeeded: 1, failed: 0, credits: 2 }],
  14,
  now,
);
const hourly = normalizeHourlySeries([], 24, now);

function resizeChart(width: number) {
  act(() => observers.at(-1)!.resize(width));
  return screen.getByRole("img", { name: /生成趋势/ });
}

function assertLabelsFit(svg: HTMLElement, containerWidth: number) {
  const group = svg.querySelector("g")!;
  const left = Number(
    group.getAttribute("transform")!.match(/translate\((\d+)/)![1],
  );
  const plotWidth = containerWidth - left - 16;
  const labels = [...svg.querySelectorAll("text")].filter(
    (text) =>
      text.textContent!.includes(":") || text.textContent!.includes("/"),
  );
  let previousEnd = -Infinity;
  for (const label of labels) {
    const x = Number(label.getAttribute("x"));
    // Five monospace characters at 12px fit within 40px, including font variation.
    const labelWidth = 40;
    const anchor =
      label.getAttribute("textAnchor") ?? label.getAttribute("text-anchor");
    const start =
      x -
      (anchor === "end"
        ? labelWidth
        : anchor === "middle"
          ? labelWidth / 2
          : 0);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start + labelWidth).toBeLessThanOrEqual(plotWidth + 0.01);
    expect(start - previousEnd).toBeGreaterThanOrEqual(4);
    expect(label).toHaveClass("text-xs");
    previousEnd = start + labelWidth;
  }
  return labels;
}

describe("admin activity chart responsiveness", () => {
  it("redraws at the observed container width while keeping readable, separated labels", () => {
    const { unmount } = render(<ActivityPanel daily={daily} hourly={hourly} />);
    const tickCounts: number[] = [];
    // Representative chart containers within 320/390/768/1024/1280/1440px pages.
    for (const width of [264, 334, 472, 728, 583, 667, 264]) {
      const svg = resizeChart(width);
      expect(svg).toHaveAttribute("viewBox", `0 0 ${width} 256`);
      const labels = assertLabelsFit(svg, width);
      expect(labels[0]).toHaveTextContent("10/25");
      expect(labels.at(-1)).toHaveTextContent("11/07");
      tickCounts.push(labels.length);
    }
    expect(tickCounts[3]).toBeGreaterThan(tickCounts[0]);
    expect(tickCounts.at(-1)).toBe(tickCounts[0]);
    expect(screen.getByRole("button", { name: "近 14 天" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it("keeps hourly labels separated when the range changes in a narrow container", () => {
    render(<ActivityPanel daily={daily} hourly={hourly} />);
    resizeChart(264);
    fireEvent.click(screen.getByRole("button", { name: "近 24 小时" }));
    const svg = screen.getByRole("img", { name: "近 24 小时生成趋势" });
    const labels = assertLabelsFit(svg, 264);
    expect(labels.at(-1)).toHaveTextContent("12:00");
    expect(screen.getByText("当前时段暂无生成")).toBeVisible();
  });

  it("shows only 1 and 0 for a one-task scale and distinguishes coincident total/success series", () => {
    render(<ActivityPanel daily={daily} hourly={hourly} />);
    const svg = resizeChart(264);
    const values = [...svg.querySelectorAll("text")]
      .map((text) => text.textContent)
      .filter((text) => /^\d+$/.test(text ?? ""));
    expect(values).toEqual(["1", "0"]);
    expect(
      svg.querySelector('path.text-info[fill="none"]'),
    ).toBeInTheDocument();
    expect(svg.querySelector("path.text-success")).toHaveAttribute(
      "stroke-dasharray",
      "5 3",
    );
    const lastPoint = svg.querySelector("g > g:last-child circle")!;
    const topTick = svg.querySelector("line")!;
    expect(Number(lastPoint.getAttribute("cy"))).toBe(
      Number(topTick.getAttribute("y1")),
    );
  });
});

describe("admin chart tick sampling", () => {
  it.each([1, 2, 3, 7, 10, 100, 1000])(
    "uses unique integer y ticks for maximum %i",
    (maximum) => {
      const ticks = chartYAxisTicks(maximum);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(ticks.every(Number.isInteger)).toBe(true);
      expect(ticks[0]).toBe(maximum);
      expect(ticks.at(-1)).toBe(0);
    },
  );

  it("reserves space for the final date instead of appending it next to the previous tick", () => {
    expect(chartTickIndices(0, 200)).toEqual([]);
    expect(chartTickIndices(1, 200)).toEqual([0]);
    expect(chartTickIndices(14, 40)).toEqual([13]);
    expect(chartTickIndices(14, 80)).toEqual([13]);
    for (const width of [208, 278, 416, 527, 611, 672]) {
      for (const count of [14, 24]) {
        const ticks = chartTickIndices(count, width);
        expect(ticks[0]).toBe(0);
        expect(ticks.at(-1)).toBe(count - 1);
        for (let index = 1; index < ticks.length; index++) {
          const gap = ((ticks[index] - ticks[index - 1]) * width) / (count - 1);
          expect(gap).toBeGreaterThanOrEqual(64);
        }
      }
    }
  });
});
