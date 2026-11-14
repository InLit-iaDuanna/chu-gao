"use client";

import { useEffect, useState } from "react";
import {
  Code2,
  ImageIcon,
  Lightbulb,
  PenLine,
  type LucideIcon,
} from "lucide-react";

import { Xiie, type XiiePose } from "./chat/Xiie";

const STARTERS: { kind: string; text: string; icon: LucideIcon }[] = [
  { kind: "聊方向", text: "帮我想三个新品海报的方向，别太网红", icon: Lightbulb },
  {
    kind: "出图",
    text: "/生图 雨夜的山城老街，暖色灯火，电影感横版",
    icon: ImageIcon,
  },
  { kind: "改稿", text: "把下面这段产品文案改得更口语一点：", icon: PenLine },
  {
    kind: "做页面",
    text: "做一个个人作品集的落地页，风格安静一点",
    icon: Code2,
  },
];

/**
 * Greetings take turns: each is typed out, held, erased, then the next one
 * is typed. A greeting may pause after its question (`pauseAt`).
 */
const GREETINGS: { text: string; pauseAt?: number }[] = [
  { text: "今天出什么稿？" },
  { text: "准备好改变世界了？来聊聊", pauseAt: "准备好改变世界了？".length },
];
const TYPE_MS = 95;
const ERASE_MS = 40;
const PAUSE_MS = 1_200;
const HOLD_MS = 6_000;

function useGreetingCarousel() {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const run = (at: number) => {
      clearTimeout(timer);
      const { text, pauseAt } = GREETINGS[at];
      setIndex(at);
      if (motion?.matches) {
        // No typing: show each greeting whole and swap it in place.
        setLength(text.length);
        timer = setTimeout(() => run((at + 1) % GREETINGS.length), HOLD_MS);
        return;
      }
      let count = 0;
      setLength(0);
      const erase = () => {
        count -= 1;
        setLength(count);
        timer =
          count > 0
            ? setTimeout(erase, ERASE_MS)
            : setTimeout(() => run((at + 1) % GREETINGS.length), 400);
      };
      const type = () => {
        count += 1;
        setLength(count);
        if (count === text.length) timer = setTimeout(erase, HOLD_MS);
        else
          timer = setTimeout(type, count === pauseAt ? PAUSE_MS : TYPE_MS);
      };
      timer = setTimeout(type, 160);
    };
    run(0);
    const restart = () => run(0);
    motion?.addEventListener("change", restart);
    return () => {
      clearTimeout(timer);
      motion?.removeEventListener("change", restart);
    };
  }, []);

  return { text: GREETINGS[index].text, length };
}

/** Every poke moves Xiie on to its next trick; "sleeping" is not one of them. */
const TRICKS: XiiePose[] = [
  "idea",
  "done",
  "reading",
  "coding",
  "focus",
  "building",
  "running",
  "debugging",
  "thinking",
];
const DOZE_MS = 45_000;

/** Xiie on an empty page: left alone it dozes off, and a poke wakes it. */
function useGreetingXiie() {
  const [pose, setPose] = useState<XiiePose>("idea");
  // A poke always changes the pose, which starts the wait over.
  useEffect(() => {
    if (pose === "sleeping") return;
    const timer = setTimeout(() => setPose("sleeping"), DOZE_MS);
    return () => clearTimeout(timer);
  }, [pose]);
  const onPoke = () => {
    setPose((now) =>
      now === "sleeping"
        ? "idea"
        : TRICKS[(TRICKS.indexOf(now) + 1) % TRICKS.length],
    );
  };
  return { pose, onPoke };
}

/** Headline of an empty conversation, centred above the composer. */
export function StudioGreeting() {
  const { text, length } = useGreetingCarousel();
  const xiie = useGreetingXiie();
  const longest = GREETINGS.reduce(
    (a, b) => (b.text.length > a.length ? b.text : a),
    "",
  );
  return (
    <div className="flex flex-col items-center text-center">
      {/* As tall as the tallest pose, so a change of pose moves nothing. */}
      <div className="flex h-[117px] items-end">
        <Xiie pose={xiie.pose} pixel={3} onPoke={xiie.onPoke} />
      </div>
      <h1
        aria-label={text}
        className="mt-6 text-[28px] font-light leading-[1.25] tracking-[0.01em] sm:text-[36px]"
      >
        <span aria-hidden className="relative inline-grid max-w-full align-top">
          {/* Reserves the longest line so the composer never jumps. */}
          <span className="invisible [grid-area:1/1]">
            {longest}
            <span className="studio-typewriter-caret" />
          </span>
          <span className="[grid-area:1/1]">
            {text.slice(0, length)}
            <span className="studio-typewriter-caret" />
          </span>
        </span>
      </h1>
    </div>
  );
}

/** A row of quiet chips under the composer of an empty conversation. */
export function StudioStarters({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul
      aria-label="可以这样开始"
      className="mt-4 flex flex-wrap justify-center gap-2"
    >
      {STARTERS.map(({ kind, text, icon: Icon }) => (
        <li key={text}>
          <button
            type="button"
            disabled={disabled}
            title={text}
            onClick={() => onPick(text)}
            className="studio-chip inline-flex h-8 items-center gap-1.5 px-2.5 text-sm text-text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden />
            {kind}
          </button>
        </li>
      ))}
    </ul>
  );
}
