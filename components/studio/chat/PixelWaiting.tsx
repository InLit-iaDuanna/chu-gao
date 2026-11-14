import styles from "./PixelWaiting.module.css";

/*
 * The first line of a reply while the model has not produced any text yet:
 * a tiny pixel stage that rotates through three scenes.
 *   1. two figures chase each other back and forth, then run off hand in hand
 *   2. one figure tiptoes across and back, glancing over its shoulder
 *   3. one figure types at a computer and text comes out of the screen
 * Purely decorative; the status text next to it carries the meaning.
 */

// One character per pixel: "#" is solid, "+" is the lighter tone.
// Every figure faces right; the gap in the head is the eye.
// prettier-ignore
const HEAD = [
  "...######...",
  "..########..",
  "..########..",
  "..#####.##..",
  "..########..",
  "...######...",
  ".....##.....",
];
// prettier-ignore
const HEAD_PONYTAIL = [
  "...######...",
  ".#########..",
  "#.########..",
  "#.#####.##..",
  "+.########..",
  "...######...",
  ".....##.....",
];
// prettier-ignore
const RUN_STRIDE = [
  "...######...",
  "..#.####.##.",
  ".#..####...#",
  "....####....",
  "....####....",
  "...##..##...",
  "..##....##..",
  ".##......#..",
  ".........##.",
];
// prettier-ignore
const RUN_PASS = [
  "...######...",
  "...######...",
  "...######...",
  "....####....",
  "....####....",
  "....###.....",
  "....####....",
  "....#.##....",
  "....##......",
];
// prettier-ignore
const RUN_STRIDE_2 = [
  "...######...",
  ".##.####.#..",
  "#...####..#.",
  "....####....",
  "....####....",
  "...##..##...",
  "..##....##..",
  "..#......##.",
  ".##.........",
];
const runner = (head: string[]) =>
  [RUN_STRIDE, RUN_PASS, RUN_STRIDE_2, RUN_PASS].map((body) => [
    ...head,
    ...body,
  ]);

// Crouched under a beanie, hands held up in front.
// prettier-ignore
const SNEAK_HEAD = [
  "............",
  "............",
  "....++++++..",
  "...++++++++.",
  "...########.",
  "...#####.##.",
  "...########.",
  "....######..",
];
// prettier-ignore
const SNEAK_REACH = [
  "...#####.##.",
  "..#####...#.",
  "..####......",
  "..#####.....",
  "...##.##....",
  "...#...##...",
  "..##....#...",
  "........##..",
];
// prettier-ignore
const SNEAK_TIPTOE = [
  "...#####.#..",
  "..#####.##..",
  "..####......",
  "..####......",
  "...###......",
  "...###......",
  "...#.#......",
  "...#.##.....",
];
// prettier-ignore
const SNEAK_REACH_2 = [
  "...#####.##.",
  "..#####...#.",
  "..####......",
  "..####......",
  "...####.....",
  "..##..#.....",
  "..#...##....",
  ".##.........",
];
const SNEAK = [SNEAK_REACH, SNEAK_TIPTOE, SNEAK_REACH_2, SNEAK_TIPTOE].map(
  (body) => [...SNEAK_HEAD, ...body],
);

// Seated at a desk; only the hands and the screen change between frames.
// prettier-ignore
const typist = (hands: string, screen: string[]) => [
  "......................",
  "...######.............",
  "..########............",
  "..########...#########",
  `..#####.##...#${screen[0]}#`,
  `..########...#${screen[1]}#`,
  `...######....#${screen[2]}#`,
  `.....##......#${screen[3]}#`,
  "+..######....#########",
  hands,
  "+.#####..++++....###..",
  "+.####..#############.",
  "+.#######.........#...",
  "++++++.##.........#...",
  "..+....##.........#...",
  "..+....###........#...",
];
const TYPE = [
  typist("+.#######.#......#....", ["+++.+++", ".......", "++.++++", "......."]),
  typist("+.#######...#....#....", ["+++.+++", ".......", "++.++++", "+++...."]),
];
// Widths, in grid pixels, of the "words" the typist produces.
const WORDS = [3, 5, 2, 4, 6, 3, 2, 5, 4, 3];

const PIXEL = 2;

function Sprite({ frames }: { frames: string[][] }) {
  const width = frames[0][0].length * PIXEL;
  const height = frames[0].length * PIXEL;
  return (
    <span className={styles.sprite}>
      {frames.map((rows, frame) => (
        <svg
          key={frame}
          className={frames.length === 4 ? styles.frame4 : styles.frame2}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          shapeRendering="crispEdges"
        >
          {rows.flatMap((row, y) =>
            [...row].map((cell, x) =>
              cell === "." ? null : (
                <rect
                  key={`${x}-${y}`}
                  x={x * PIXEL}
                  y={y * PIXEL}
                  width={PIXEL}
                  height={PIXEL}
                  fill="currentColor"
                  opacity={cell === "+" ? 0.5 : 1}
                />
              ),
            ),
          )}
        </svg>
      ))}
    </span>
  );
}

/** Stable per reply, so a re-render does not restart on a different scene. */
function startScene(seed: string) {
  let sum = 0;
  for (let index = 0; index < seed.length; index += 1)
    sum = (sum + seed.charCodeAt(index)) % 3;
  return sum;
}

export function PixelWaiting({ seed = "" }: { seed?: string }) {
  return (
    <div
      aria-hidden="true"
      className={styles.stage}
      data-start={startScene(seed)}
    >
      <div className={`${styles.scene} ${styles.chase}`}>
        <span className={`${styles.actor} ${styles.leader}`}>
          <span className={styles.turn}>
            <Sprite frames={runner(HEAD)} />
          </span>
        </span>
        <span className={`${styles.actor} ${styles.chaser}`}>
          <span className={styles.turn}>
            <Sprite frames={runner(HEAD_PONYTAIL)} />
          </span>
          {/* The joined hands once the chaser has caught up. */}
          <span className={styles.link} />
        </span>
      </div>
      <div className={`${styles.scene} ${styles.sneak}`}>
        <span className={`${styles.actor} ${styles.sneaker}`}>
          <span className={styles.glance}>
            <Sprite frames={SNEAK} />
          </span>
        </span>
      </div>
      <div className={`${styles.scene} ${styles.type}`}>
        <span className={`${styles.actor} ${styles.typist}`}>
          <Sprite frames={TYPE} />
        </span>
        <span className={styles.words}>
          {WORDS.map((width, index) => (
            <svg
              key={index}
              width={width * PIXEL}
              height={PIXEL}
              shapeRendering="crispEdges"
            >
              <rect width={width * PIXEL} height={PIXEL} fill="currentColor" />
            </svg>
          ))}
        </span>
      </div>
    </div>
  );
}
