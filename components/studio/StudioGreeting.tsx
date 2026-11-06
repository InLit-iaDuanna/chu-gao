"use client";

import { useEffect, useState } from "react";

const QUESTION = "准备好改变世界了？";
const GREETING = QUESTION + "来聊聊";

export function StudioGreeting() {
  const [length, setLength] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const start = () => {
      clearTimeout(timer);
      if (motion?.matches) {
        setLength(GREETING.length);
        return;
      }
      let count = 0;
      setLength(0);
      const type = () => {
        count += 1;
        setLength(count);
        if (count === GREETING.length) {
          timer = setTimeout(start, 10_000);
        } else {
          timer = setTimeout(type, count === QUESTION.length ? 3_000 : 95);
        }
      };
      timer = setTimeout(type, 160);
    };
    start();
    motion?.addEventListener("change", start);
    return () => {
      clearTimeout(timer);
      motion?.removeEventListener("change", start);
    };
  }, []);

  return (
    <h1
      aria-label={GREETING}
      className="text-center text-2xl font-medium leading-9 tracking-normal sm:text-[26px] sm:leading-10"
    >
      <span
        aria-hidden
        className="relative inline-grid max-w-full text-center align-top"
      >
        <span className="invisible [grid-area:1/1]">
          {GREETING}
          <span className="studio-typewriter-caret" />
        </span>
        <span className="[grid-area:1/1]">
          {GREETING.slice(0, length)}
          <span className="studio-typewriter-caret" />
        </span>
      </span>
    </h1>
  );
}
