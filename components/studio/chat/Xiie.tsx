"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  XIIE_ART,
  XIIE_PUFFS,
  type XiieBone,
  type XiiePaint,
  type XiiePose,
  type XiiePuff,
} from "./xiie-art";
import styles from "./Xiie.module.css";

export type { XiiePose };

/**
 * Something Xiie shows on cue, the way it answers a poke: a nod, or a
 * little mark floating up. A new `id` plays it again.
 */
export type XiieCue = { id: number; kind: XiiePuff | "nod" };

function Paint({ paint }: { paint: XiiePaint }) {
  return paint.map(({ ink, d }) => <path key={ink} className={styles[ink]} d={d} />);
}

const names = (...list: (string | false | undefined)[]) =>
  list.filter(Boolean).join(" ");

function Bone({ bone }: { bone: XiieBone }) {
  return (
    <g
      className={names(styles.bone, styles[bone.name])}
      style={
        bone.pivot && { transformOrigin: `${bone.pivot[0]}px ${bone.pivot[1]}px` }
      }
    >
      {bone.paint ? <Paint paint={bone.paint} /> : null}
      {bone.eyes?.map(([x, y, width, height]) => (
        <rect
          key={x}
          data-eye
          className={names(styles.bone, styles.eye, styles.d)}
          x={x}
          y={y}
          width={width}
          height={height}
        />
      ))}
      {bone.bones?.map((child) => (
        <Bone key={child.name} bone={child} />
      ))}
    </g>
  );
}

/** A poke answers with one of these in turn; waking up gets the "!". */
const PUFFS: XiiePuff[] = ["heart", "note", "heart", "star"];
const SQUASH = [
  "scale(1, 1)",
  "scale(1.12, 0.82)",
  "scale(0.93, 1.09)",
  "scale(1.04, 0.96)",
  "scale(1, 1)",
].map((transform) => ({ transform }));
const SQUINT = [0.15, 0.15, 1].map((y) => ({ transform: `scaleY(${y})` }));
/** Two small dips, gentler than a poke. */
const NOD = [
  "scale(1, 1)",
  "scale(1.04, 0.93)",
  "scale(1, 1)",
  "scale(1.03, 0.95)",
  "scale(1, 1)",
].map((transform) => ({ transform }));

/**
 * Xiie, the studio's pixel lizard, as a jointed paper puppet: each drawing in
 * xiie-art.ts is a tree of bones, and Xiie.module.css turns every bone about
 * its joint, so the browser plays it without a line of script. Poke it and
 * it squashes, squints and lets a little heart go.
 */
export function Xiie({
  pose,
  pixel = 2,
  at,
  className,
  onPoke,
  cue,
}: {
  pose: XiiePose;
  /** CSS pixels per art pixel. */
  pixel?: number;
  /** Freeze on the frame at this many seconds instead of playing. */
  at?: number;
  className?: string;
  onPoke?: () => void;
  cue?: XiieCue | null;
}) {
  const art = XIIE_ART[pose];
  const svg = useRef<SVGSVGElement>(null);
  const pokes = useRef(0);
  const [puffs, setPuffs] = useState<{ id: number; kind: XiiePuff }[]>([]);
  const frozen = at !== undefined;

  const poke = () => {
    const id = (pokes.current += 1);
    const kind = pose === "sleeping" ? "bang" : PUFFS[(id - 1) % PUFFS.length];
    setPuffs((list) => [...list.slice(-3), { id, kind }]);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Not every browser (or test DOM) can animate from script.
    if (!still && svg.current?.animate) {
      svg.current.animate(SQUASH, { duration: 520, easing: "ease-out" });
      for (const eye of svg.current.querySelectorAll("[data-eye]"))
        eye.animate(SQUINT, { duration: 520, easing: "ease-in" });
    }
    onPoke?.();
  };

  const played = useRef<number | null>(null);
  useEffect(() => {
    if (!cue || frozen || played.current === cue.id) return;
    played.current = cue.id;
    const id = (pokes.current += 1);
    if (cue.kind !== "nod") {
      const kind = cue.kind;
      setPuffs((list) => [...list.slice(-3), { id, kind }]);
    }
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still || !svg.current?.animate) return;
    svg.current.animate(NOD, { duration: 640, easing: "ease-in-out" });
    if (cue.kind === "heart" || cue.kind === "star")
      for (const eye of svg.current.querySelectorAll("[data-eye]"))
        eye.animate(SQUINT, { duration: 640, easing: "ease-in" });
  }, [cue, frozen]);

  return (
    <svg
      ref={svg}
      aria-hidden
      data-pose={pose}
      className={names(styles.xiie, styles[pose], frozen && styles.frozen, className)}
      style={frozen ? ({ "--xiie-at": `${-at}s` } as CSSProperties) : undefined}
      width={art.width * pixel}
      height={art.height * pixel}
      viewBox={`0 0 ${art.width} ${art.height}`}
      onClick={frozen ? undefined : poke}
      // Poking must not start selecting the reply around it, so the press
      // default (the start of a double- or triple-click selection) is blocked.
      onPointerDown={(event) => {
        if (event.button === 0) event.preventDefault();
      }}
      onMouseDown={(event) => {
        if (event.button === 0) event.preventDefault();
      }}
    >
      {/* Keyed by pose, so a change of pose pops in rather than snapping. */}
      <g key={pose} className={styles.enter}>
        {art.bones.map((bone) => (
          <Bone key={bone.name} bone={bone} />
        ))}
      </g>
      <g transform={`translate(${art.top[0]} ${art.top[1]})`}>
        {puffs.map(({ id, kind }) => (
          <g
            key={id}
            className={styles.puff}
            onAnimationEnd={() =>
              setPuffs((list) => list.filter((puff) => puff.id !== id))
            }
          >
            <Paint paint={XIIE_PUFFS[kind]} />
          </g>
        ))}
      </g>
    </svg>
  );
}
