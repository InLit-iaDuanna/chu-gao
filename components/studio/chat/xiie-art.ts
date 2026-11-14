/**
 * Xiie's drawings, cut into the bones its skeleton moves.
 *
 * The art follows the studio's reference sheet pixel for pixel. A part is
 * written row by row as runs of ink, in the sheet's own grid:
 * `12: "g8-24 y11-13"` reads "on row 12, green from column 8 to 24, then a
 * light patch over columns 11 to 13". Later runs paint over earlier ones.
 * Parts overlap a little at every joint so nothing opens up when they turn.
 *
 * Inks: g skin, y light patch, c cream, s skin in shadow, b bulb yellow,
 * d eye ink, k solid things (laptop, book), h heart, and p for loose marks
 * (dark on a light page, light on a dark one). Eyes are separate boxes.
 */
export type XiieInk = "g" | "y" | "c" | "s" | "b" | "k" | "d" | "h" | "p";
export type XiiePaint = { ink: XiieInk; d: string }[];
type Rows = Record<number, string>;
type Point = [number, number];
/** x, y, width, height. */
type Box = [number, number, number, number];

const INKS: XiieInk[] = ["g", "y", "c", "s", "b", "k", "d", "h", "p"];

/** One closed outline around a set of pixels, so a turned part has no seams. */
function outline(cells: Point[]): string {
  const key = (x: number, y: number) => (y + 16) * 128 + x + 16;
  const filled = new Set(cells.map(([x, y]) => key(x, y)));
  const edges = new Map<number, Point[]>();
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const from = key(x0, y0);
    edges.set(from, [...(edges.get(from) ?? []), [x1, y1]]);
  };
  for (const [x, y] of cells) {
    if (!filled.has(key(x, y - 1))) edge(x, y, x + 1, y);
    if (!filled.has(key(x + 1, y))) edge(x + 1, y, x + 1, y + 1);
    if (!filled.has(key(x, y + 1))) edge(x + 1, y + 1, x, y + 1);
    if (!filled.has(key(x - 1, y))) edge(x, y + 1, x, y);
  }
  let d = "";
  for (const [x, y] of cells) {
    const first = edges.get(key(x, y));
    while (first?.length) {
      let at: Point = [x, y];
      let line = `M${x} ${y}`;
      let run: Point = [0, 0];
      const flush = () => {
        if (run[0]) line += `h${run[0]}`;
        if (run[1]) line += `v${run[1]}`;
      };
      for (;;) {
        const to = edges.get(key(at[0], at[1]))!.pop()!;
        const step: Point = [to[0] - at[0], to[1] - at[1]];
        if ((step[0] !== 0) !== (run[0] !== 0)) {
          flush();
          run = [0, 0];
        }
        run = [run[0] + step[0], run[1] + step[1]];
        at = to;
        if (to[0] === x && to[1] === y) break;
      }
      flush();
      d += `${line}z`;
    }
  }
  return d;
}

function paint(rows: Rows, dx: number, dy: number, under?: XiieInk): XiiePaint {
  const cells: [Point, XiieInk][] = [];
  for (const [row, runs] of Object.entries(rows)) {
    const line = new Map<number, XiieInk>();
    for (const run of runs.split(" ").filter(Boolean)) {
      const [from, to = from] = run.slice(1).split("-").map(Number);
      for (let x = from; x <= to; x += 1) line.set(x, run[0] as XiieInk);
    }
    for (const [x, ink] of line) cells.push([[x + dx, Number(row) + dy], ink]);
  }
  // The whole silhouette goes down in one ink first; details sit on it.
  const base = under ?? cells[0][1];
  const out: XiiePaint = [{ ink: base, d: outline(cells.map(([cell]) => cell)) }];
  for (const ink of INKS) {
    if (ink === base) continue;
    const own = cells.filter(([, cell]) => cell === ink).map(([cell]) => cell);
    if (own.length) out.push({ ink, d: outline(own) });
  }
  return out;
}

/**
 * A bone is drawn in this order: its own paint, its eyes, then its child
 * bones, which move with it. `name` is its class in Xiie.module.css, and
 * that class is what animates it; `pivot` is the joint it turns about.
 */
export type XiieBone = {
  name: string;
  pivot?: Point;
  paint?: XiiePaint;
  eyes?: Box[];
  bones?: XiieBone[];
};

export type XiieArt = {
  width: number;
  height: number;
  /** Just above the head, where a poke's little heart floats up from. */
  top: Point;
  bones: XiieBone[];
};

const bone = (
  name: string,
  pivot?: Point,
  paint?: XiiePaint,
  ...bones: XiieBone[]
): XiieBone => ({ name, pivot, paint, bones });

/** Tools for drawing one pose `dx`, `dy` in from the corner of its canvas. */
function sheet(dx: number, dy: number) {
  const at = (x: number, y: number): Point => [x + dx, y + dy];
  const part = (rows: Rows, under?: XiieInk) => paint(rows, dx, dy, under);
  return {
    at,
    part,
    eyes: (...boxes: Box[]): XiieBone => ({
      name: "eyes",
      eyes: boxes.map(([x, y, w, h]) => [x + dx, y + dy, w, h]),
    }),
    /** Three segments, root to tip, each hanging off the one before. */
    tail: (segments: Rows[], joints: Point[]): XiieBone =>
      segments.reduceRight<XiieBone | undefined>(
        (tip, rows, i) => bone(`tail${i}`, joints[i], part(rows), ...(tip ? [tip] : [])),
        undefined,
      )!,
  };
}

// ── thinking: sitting, a paw at the chin, a "?" overhead ────────────────
function thinking(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 2);
  const ground = at(14, 30);
  return {
    width: 32,
    height: 33,
    top: at(13, 5),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              24: "g0-4 y1-2",
              25: "g0-7 y5",
              26: "g1-8",
              27: "g1-8",
              28: "g2-8",
              29: "g4-8",
            },
            {
              19: "g1-3",
              20: "g1-3",
              21: "g0-3",
              22: "g0-3",
              23: "g0-3 y2-3",
              24: "g0-4 y1-2",
              25: "g0-4",
            },
            { 17: "g3-5", 18: "g2-4", 19: "g1-3", 20: "g1-3" },
          ],
          [at(7.5, 27.5), at(2.5, 25), at(2.5, 20.5)],
        ),
        bone(
          "body",
          ground,
          part({
            // The first two rows only show when the head lifts.
            15: "g8-12 c13-22",
            16: "g8-12 c13-22",
            17: "g8-10 c11-23",
            18: "g8-10 c11-22",
            19: "g9-11 c12-19",
            20: "g10-13 c14-19",
            21: "g9-13 y9 c14-19",
            22: "g8-12 y8-9 c13-19",
            23: "g7-13 y8 c14-19",
            24: "g7-16 c17-18 g19-21",
            25: "g6-16 y9-10 c17-19 g20-21",
            26: "g6-16 y10-11 c17-19 g20-22",
            27: "g6-15 c16-19 g20-23",
            28: "g5-16 c17-18 g19-23",
            29: "g5-22",
          }),
          bone(
            "arm",
            at(20, 25),
            part({
              19: "g18-21",
              20: "g18-21",
              21: "g18-21",
              22: "g18-22",
              23: "g18-22",
              24: "g18-21",
            }),
          ),
          bone(
            "head",
            at(15.5, 17),
            part({
              7: "g13-19",
              8: "g11-21 y14-16",
              9: "g10-22 y13-14",
              10: "g9-23 y11-13",
              11: "g8-23",
              12: "g8-24",
              13: "g7-24",
              14: "g7-24",
              15: "g7-24",
              16: "g7-23",
            }),
            eyes([15, 12.25, 1.5, 2.5], [21.5, 12.25, 1.5, 2.5]),
          ),
        ),
      ),
      bone(
        "prop",
        at(25.5, 3.5),
        part({ 0: "p24-26", 1: "p23 p27", 2: "p27", 3: "p26", 4: "p25", 6: "p25" }),
      ),
    ],
  };
}

// ── idea: up on its feet, one arm raised, a bulb lighting overhead ──────
function idea(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 3);
  const ground = at(14, 35);
  const bulb = at(28.5, 5);
  return {
    width: 38,
    height: 39,
    top: at(16, 8),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              26: "g0-4 y2",
              27: "g0-5",
              28: "g1-7 y5",
              29: "g1-7",
              30: "g2-7",
              31: "g3-7",
            },
            {
              21: "g1-3",
              22: "g1-3",
              23: "g0-3",
              24: "g0-3 y3",
              25: "g0-3 y2-3",
              26: "g0-4 y2",
              27: "g0-4",
            },
            { 18: "g5-7", 19: "g3-5", 20: "g2-4", 21: "g1-3", 22: "g1-3" },
          ],
          [at(7.5, 29.5), at(2.5, 27), at(2.5, 22.5)],
        ),
        bone(
          "body",
          ground,
          part({
            18: "g10-13 c14-26",
            19: "g10-13 c14-26",
            20: "g10-12 c13-26",
            21: "g11-12 c13-25",
            22: "g12-13 c14-24",
            23: "g11-15 y11 c16-23",
            24: "g10-15 y10-11 c16-22",
            25: "g9-14 y9-10 c15-21",
            26: "g8-14 y9 c15-21",
            27: "g7-16 c17-20 g21-22",
            28: "g6-17 c18-20 g21",
            29: "g6-18 y12-13 c19 g20-21",
            30: "g6-21 y12-14",
            31: "g6-21 y13-14",
            32: "g6-21",
            33: "g5-22",
            // Two feet. The sheet draws each with two toes, which read as four.
            34: "g6-11 g17-22",
          }),
          bone(
            "arm",
            at(21.5, 27.5),
            part({
              22: "g25-27",
              23: "g23-27",
              24: "g22-26",
              25: "g21-25",
              26: "g21-24",
              27: "g21-23",
            }),
          ),
          bone(
            "head",
            at(18.5, 20),
            part({
              10: "g15-21",
              11: "g13-23 y16-18",
              12: "g12-25 y13-15",
              13: "g11-26 y13-15",
              14: "g10-26",
              15: "g10-27",
              16: "g9-27",
              17: "g9-27",
              18: "g9-27",
              19: "g9-26",
            }),
            eyes([17.7, 15.5, 1.5, 2.5], [24.7, 15.5, 1.5, 2.5]),
          ),
        ),
      ),
      bone(
        "prop",
        bulb,
        undefined,
        bone(
          "glow",
          bulb,
          part({
            3: "b27-29",
            4: "b26-30 c29",
            5: "b26-30",
            6: "b27-29",
            7: "b27-29",
          }),
        ),
        bone(
          "glass",
          bulb,
          part({
            2: "p27-29",
            3: "p26 p30",
            4: "p25 p31",
            5: "p25 p31",
            6: "p26 p30",
            8: "p27-29",
            9: "p28",
          }),
        ),
        bone(
          "rays",
          bulb,
          part({
            [-1]: "p28",
            0: "p28",
            1: "p23 p33",
            2: "p24 p32",
            4: "p22-23 p33-34",
          }),
        ),
      ),
    ],
  };
}

/** The `</>` on a laptop lid whose top-left corner is at `x`, `y`. */
const codeGlyph = (x: number, y: number): Rows => ({
  [y + 2]: `c${x + 3} c${x + 6} c${x + 8}`,
  [y + 3]: `c${x + 2} c${x + 6} c${x + 9}`,
  [y + 4]: `c${x + 3} c${x + 5} c${x + 8}`,
  [y + 5]: `c${x + 5}`,
});

// ── coding: flat on its belly, typing at a laptop ───────────────────────
function coding(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 2);
  const ground = at(14, 29);
  return {
    width: 41,
    height: 32,
    top: at(21, 5),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              17: "g0-3",
              18: "g0-5 y2-3",
              19: "g0-6",
              20: "g0-7 y6-7",
              21: "g1-8 y6-7",
              22: "g1-8",
              23: "g2-8",
              24: "g3-8",
            },
            {
              12: "g1-4",
              13: "g1-4 y3-4",
              14: "g1-4 y3-4",
              15: "g0-4",
              16: "g0-4",
              17: "g0-5 y3-5",
              18: "g0-5 y2-3",
            },
            { 9: "g6-9", 10: "g3-7", 11: "g2-6", 12: "g1-5" },
          ],
          [at(7, 22), at(2.5, 18), at(2.5, 12.5)],
        ),
        bone(
          "body",
          ground,
          part({
            15: "g13-15 c16-28",
            16: "g13-15 c16-28",
            17: "g13-14 c15-29",
            18: "g10-15 y12 c16-29",
            19: "g9-16 y11-13 c17-26",
            20: "g6-17 y6-8 y11-12 c18-24",
            21: "g5-17 y6-7 c18-22",
            22: "g5-17 c18-21",
            23: "g4-16 c17-20",
            24: "g4-18 c19-20",
            25: "g4-19 c9-12",
            26: "g4-19 c9-13",
            27: "g3-9",
            28: "g3-9",
          }),
          bone(
            "head",
            at(20, 17),
            part({
              7: "g19-24",
              8: "g16-27 y19-21",
              9: "g15-28 y16-22",
              10: "g14-29 y16-18",
              11: "g13-30",
              12: "g12-30",
              13: "g12-31",
              14: "g12-31",
              15: "g12-31",
              16: "g13-30",
              17: "g18-29",
            }),
            eyes([20.9, 13.2, 1.4, 2.6], [27.8, 13.2, 1.4, 2.6]),
          ),
        ),
        bone(
          "laptop",
          undefined,
          part({
            20: "k24-36",
            21: "k24-36",
            22: "k24-36",
            23: "k24-36",
            24: "k24-36",
            25: "k24-36",
            26: "k23-36",
            27: "k16-34",
            28: "k16-34",
          }),
          bone("glyph", undefined, part(codeGlyph(25, 20))),
        ),
        bone(
          "arm",
          at(21.5, 22),
          part({
            22: "g21-22",
            23: "g21-23",
            24: "g21-23",
            25: "g21-23",
            26: "g22-23",
          }),
        ),
      ),
      bone(
        "prop",
        undefined,
        undefined,
        bone("spark0", at(30, 1.5), part({ 0: "p30-31", 1: "p29-30", 2: "p29" })),
        bone("spark1", at(33.5, 3.5), part({ 2: "p34", 3: "p33-34", 4: "p32-33" })),
        bone("spark2", at(35, 7), part({ 6: "p35-36", 7: "p34-35" })),
      ),
    ],
  };
}

// ── focus: the same desk, headphones on ─────────────────────────────────
function focus(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 2);
  const ground = at(14, 24);
  return {
    width: 41,
    height: 27,
    top: at(21, -1),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              18: "g0-4 y2",
              19: "g0-8",
              20: "g1-8",
              21: "g1-8",
              22: "g2-8",
            },
            {
              13: "g1-3",
              14: "g0-3",
              15: "g0-3",
              16: "g0-3 y2-3",
              17: "g0-3 y1-3",
              18: "g0-4 y2",
            },
            { 10: "g4-6", 11: "g2-4", 12: "g1-3", 13: "g1-3" },
          ],
          [at(7, 20.5), at(2, 18.5), at(2, 13.5)],
        ),
        bone(
          "body",
          ground,
          part({
            12: "g13-15 c16-28",
            13: "g13 c14-28",
            14: "g12-14 c15-29",
            15: "g10-16 y12 c17-25",
            16: "g9-17 y11-12 c18-24",
            17: "g7-17 y7-8 y11 c18-22",
            18: "g6-16 y6-7 c17-22",
            19: "g4-16 c17-21",
            20: "g4-18 c19-21",
            21: "g4-20 c11-13",
            22: "g4-19 c10-14",
            23: "g5-10 c12-15",
          }),
          bone(
            "head",
            at(21, 13.5),
            part({
              2: "g18-23",
              3: "g16-26 y18-20",
              4: "g14-27 y18-22",
              5: "g13-28 y15-17",
              6: "g13-29",
              7: "g13-30",
              8: "g13-30",
              9: "g13-30",
              10: "g13-30",
              11: "g13-30",
              12: "g13-30",
              13: "g16-29",
            }),
            eyes([20, 9.2, 1.4, 2.6], [27.3, 9.2, 1.4, 2.6]),
            bone(
              "phones",
              undefined,
              part(
                {
                  0: "k16-25",
                  1: "k14-16 k25-27",
                  2: "k13-14 k27-28",
                  3: "k12-13 k28-29",
                  4: "k11-12 k28-29",
                  5: "k11-12 k29-30",
                  6: "k9-12 k30-31",
                  7: "k9 c10-11 k12-13 k30 c31 k32",
                  8: "k8 c9-11 k12-13 c31 k32",
                  9: "k8 c9-11 k12-13 c31 k32",
                  10: "k8 c9-11 k12-13 c31 k32",
                  11: "k8 c9-11 k12-13 c31 k32",
                  12: "k8 c9-11 k12-13 k31",
                  13: "k9-12 k30",
                },
                "k",
              ),
            ),
          ),
        ),
        bone(
          "laptop",
          undefined,
          part({
            15: "k24-36",
            16: "k24-36",
            17: "k24-36",
            18: "k24-36",
            19: "k24-36",
            20: "k24-36",
            21: "k24-36",
            22: "k20-35",
            23: "k16-35",
          }),
          bone("glyph", undefined, part(codeGlyph(25, 15))),
        ),
        bone(
          "arm",
          at(21.5, 17.5),
          part({
            17: "g21-22",
            18: "g21-22",
            19: "g21-23",
            20: "g20-23",
            21: "g22-23",
          }),
        ),
      ),
    ],
  };
}

// ── sleeping: curled into a ball, z z z ─────────────────────────────────
function sleeping(): XiieArt {
  const { at, part, eyes } = sheet(2, 5);
  const ground = at(14, 29);
  return {
    width: 33,
    height: 35,
    top: at(9, 10),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        bone(
          "body",
          ground,
          part({
            12: "g8-13",
            13: "g6-21",
            14: "g4-23 s15",
            15: "g3-24 y8-10 y16-20 y23 s13-14",
            16: "g2-25 y5-10 y13-15 s12",
            17: "g1-27 y4-9 y13-15 s11",
            18: "g1-27 y3-9 s10",
            19: "g0-28 y3-6 s10",
            20: "g0-28 s10",
            21: "g0-28 s10",
            22: "g0-28 y4-5 s10",
            23: "g0-27 y4-6 s10",
            24: "g1-27 y4-8 s10 c21-27",
            25: "g1-27 y5-8 s10 y11-12 s14-16 c18-26",
            26: "g2-27 y7 y12-13 c21-24",
            27: "g3-26 c22-23",
            28: "g5-21",
          }),
          // Shut eyes: two short lines.
          eyes([17, 21.05, 3.2, 0.95], [25, 21.05, 2.8, 0.95]),
        ),
      ),
      bone(
        "prop",
        undefined,
        undefined,
        bone(
          "z0",
          at(17, 8),
          part({ 6: "p15-18", 7: "p17", 8: "p16", 9: "p15-18" }),
        ),
        bone(
          "z1",
          at(22, 3.5),
          part({ 1: "p20-24", 2: "p23", 3: "p22", 4: "p21", 5: "p20-24" }),
        ),
        bone(
          "z2",
          at(28, -1),
          part({
            [-4]: "p25-30",
            [-3]: "p29",
            [-2]: "p28",
            [-1]: "p27",
            0: "p26",
            1: "p25-30",
          }),
        ),
      ),
    ],
  };
}

// ── running: at full stretch, dust lines streaming behind ───────────────
function running(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 4);
  const ground = at(20, 19);
  return {
    width: 42,
    height: 24,
    top: at(28, -4),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              11: "g6-13",
              12: "g7-14",
              13: "g8-15",
              14: "g9-15",
              15: "g11-15",
            },
            {
              7: "g7-10",
              8: "g6-10",
              9: "g6-10 y9-10",
              10: "g6-11 y8-9",
              11: "g6-11",
              12: "g7-12",
            },
            {
              3: "g11-13",
              4: "g9-15",
              5: "g8-12 y9-10",
              6: "g7-11 y9-10",
              7: "g7-10",
            },
          ],
          [at(13, 13.5), at(9, 12), at(8.5, 7.5)],
        ),
        bone(
          "body",
          at(20, 13),
          part({
            6: "g21-22 c23-35",
            7: "g21-22 c23-35",
            8: "g20-21 c22-36",
            9: "g16-22 y19-20 c23-35",
            10: "g15-24 y15 y17-20 c25-32",
            11: "g12-24 y14-15 y18 c25-28",
            12: "g12-24 c25-28",
            13: "g12-28",
            14: "g12-27 c21",
            15: "g14-26 c18-23",
            16: "c17-24",
            17: "c18-21",
          }),
          bone(
            "hindleg",
            at(14, 14),
            part({
              13: "g10-17",
              14: "g9-17",
              15: "g11-17",
              16: "g10-16",
              17: "g10-17",
              18: "g11-13",
            }),
          ),
          bone(
            "foreleg",
            at(27.5, 12.5),
            part({
              11: "g29-30",
              12: "g28-31",
              13: "g27-32",
              14: "g27-32",
              15: "g29-31",
            }),
          ),
          bone(
            "head",
            at(27, 8),
            part({
              [-2]: "g25-31",
              [-1]: "g23-33 y26-29",
              0: "g22-35 y24-29",
              1: "g21-36 y22-25",
              2: "g20-36",
              3: "g20-37",
              4: "g19-37",
              5: "g19-37",
              6: "g19-37",
              7: "g19-36",
            }),
            eyes([27.7, 3.3, 1.3, 2.4], [34.5, 3.3, 1.3, 2.4]),
          ),
        ),
      ),
      bone(
        "prop",
        undefined,
        undefined,
        bone("dash0", undefined, part({ 0: "p6-10" })),
        bone("dash1", undefined, part({ 3: "p2-5" })),
        bone("dash2", undefined, part({ 6: "p0-3" })),
        bone("dash3", undefined, part({ 17: "p3-6" })),
      ),
    ],
  };
}

/** A four-pointed sparkle centred on `x`, `y`. */
const sparkle = (x: number, y: number): Rows => ({
  [y - 1]: `p${x}`,
  [y]: `p${x - 1} b${x} p${x + 1}`,
  [y + 1]: `p${x}`,
});

// ── done: both arms up, sparkles all round ──────────────────────────────
function done(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 2);
  const ground = at(16, 28);
  const star = (name: string, x: number, y: number) =>
    bone(name, at(x + 0.5, y + 0.5), part(sparkle(x, y), "p"));
  return {
    width: 36,
    height: 31,
    top: at(16, 1),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              20: "g1-6",
              21: "g2-8 y6-7",
              22: "g2-9",
              23: "g3-9",
              24: "g4-9",
              25: "g5-9",
            },
            {
              16: "g1-4",
              17: "g1-4",
              18: "g1-4 y3-4",
              19: "g1-4 y2-3",
              20: "g1-6",
              21: "g2-5",
            },
            { 12: "g4", 13: "g3-4", 14: "g2-4", 15: "g2-4", 16: "g1-4" },
          ],
          [at(8.5, 23.5), at(3.5, 21), at(2.5, 16.5)],
        ),
        bone(
          "body",
          ground,
          part({
            10: "g11-13 c14-22",
            11: "g11-13 c14-22",
            12: "c10-24",
            13: "c11-23",
            14: "c12-23",
            15: "c13-21",
            16: "g12-14 c15-20 g21-22",
            17: "g11-14 c15-21 g22",
            18: "g11-14 c15-21 g22-23",
            19: "g10-14 y10-11 c15-21 g22",
            20: "g9-14 y10 c15-21 g22",
            21: "g8-14 c15-21 g22",
            22: "g8-13 c14-21 g22",
            23: "g8-14 c15-20 g21-23",
            24: "g8-14 c15-19 g20-23",
            25: "g8-13 c14-17 g18-23",
            26: "g8-14 g19-24",
            27: "g8-14 g19-24",
          }),
          bone(
            "head",
            at(16, 13),
            part({
              3: "g13-19",
              4: "g11-22 y14-16",
              5: "g10-23 y11-13",
              6: "g9-24 y11-13",
              7: "g8-25",
              8: "g7-25",
              9: "g7-25",
              10: "g7-25",
              11: "g7-25",
              12: "g7-24",
            }),
            eyes([15.8, 8.2, 1.5, 2.2], [22.6, 8.2, 1.5, 2.2]),
          ),
          bone(
            "arm",
            at(13, 16.5),
            part({
              11: "g7-9",
              12: "g7-10",
              13: "g7-10",
              14: "g7-11",
              15: "g8-12",
              16: "g9-14",
              17: "g10-14",
            }),
          ),
          bone(
            "arm2",
            at(22, 16.5),
            part({
              11: "g26",
              12: "g26-27",
              13: "g25-27",
              14: "g24-27",
              15: "g23-26",
              16: "g21-25",
              17: "g22-24",
            }),
          ),
        ),
      ),
      bone(
        "prop",
        undefined,
        undefined,
        star("star0", 5, 1),
        star("star1", 1, 6),
        star("star2", 27, 1),
        star("star3", 30, 6),
      ),
    ],
  };
}

// ── debugging: ducking behind a screen that shows a warning ─────────────
function debugging(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 2);
  const ground = at(15, 22);
  return {
    width: 37,
    height: 25,
    top: at(17, -1),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              16: "g0-4",
              17: "g0-8",
              18: "g1-8",
              19: "g2-8",
              20: "g3-8",
              21: "g4-8 y4",
            },
            {
              12: "g1-3",
              13: "g0-3",
              14: "g0-3 y2-3",
              15: "g0-4 y2-3",
              16: "g0-4",
              17: "g0-4",
            },
            { 9: "g3-6", 10: "g2-4", 11: "g1-3", 12: "g1-3" },
          ],
          [at(8, 19), at(2.5, 17), at(2, 12.5)],
        ),
        // What shows of the body beside the screen.
        bone(
          "haunch",
          undefined,
          part({
            14: "g8-12",
            15: "g8-12",
            16: "g7-12",
            17: "g6-12",
            18: "g6-12",
            19: "g6-12",
            20: "g6-12",
            21: "g6-12",
          }),
        ),
        // Head and chest go up and down together behind the screen.
        bone(
          "peek",
          undefined,
          part({
            9: "g10-12 c13-24",
            10: "g10-12 c13-24",
            11: "g9-10 c11-24",
            12: "g9-10 c11-25",
            13: "g10-13 c14-24",
            14: "g11-13 c14-24",
            15: "g11-13 c14-24",
            16: "g11-13 c14-24",
          }),
          bone(
            "head",
            at(17, 12),
            part({
              1: "g14-20",
              2: "g12-22 y14-16",
              3: "g11-23 y14-18 y21-22",
              4: "g10-24 y11-13",
              5: "g9-25",
              6: "g9-25",
              7: "g8-26",
              8: "g8-26",
              9: "g8-26",
              10: "g8-26",
              11: "g12-25",
            }),
            eyes([16.2, 7.2, 1.5, 2.8], [23.4, 7.2, 1.5, 2.8]),
          ),
        ),
        bone(
          "screen",
          undefined,
          part({
            14: "k9-29",
            15: "k9-29",
            16: "k9-29",
            17: "k9-29",
            18: "k9-29",
            19: "k9-29",
            20: "k9-29",
            21: "k9-29",
          }),
          // A warning triangle; the "!" is the screen showing through.
          bone(
            "alert",
            at(19.5, 18),
            part({
              15: "c19",
              16: "c18 c20",
              17: "c17-18 c20-21",
              18: "c17-21",
              19: "c16-18 c20-22",
              20: "c15-23",
            }),
          ),
          // Paws on the top edge.
          bone("paws", undefined, part({ 13: "g9-10 g25-27" })),
        ),
      ),
      bone(
        "prop",
        undefined,
        undefined,
        bone("spark0", at(29, 1.5), part({ 0: "p29", 1: "p28-29", 2: "p28" })),
        bone("spark1", at(31.5, 3), part({ 2: "p31-32", 3: "p30-31" })),
        bone("spark2", at(31.5, 5.5), part({ 5: "p31-32", 6: "p30-31" })),
      ),
    ],
  };
}

// ── reading: round glasses, an open book in both paws ───────────────────
function reading(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 2);
  const ground = at(14, 23);
  return {
    width: 34,
    height: 27,
    top: at(17, -2),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              16: "g0-4",
              17: "g0-5 y5",
              18: "g1-8 y5",
              19: "g1-8",
              20: "g2-8",
              21: "g3-8",
              22: "g5-8",
            },
            {
              12: "g1-3",
              13: "g0-3",
              14: "g0-3 y2-3",
              15: "g0-3 y1-3",
              16: "g0-4 y2",
              17: "g0-4",
            },
            { 8: "g4-5", 9: "g2-4", 10: "g1-4", 11: "g1-3", 12: "g1-3 y3" },
          ],
          [at(7.5, 19.5), at(2.5, 17), at(2, 12.5)],
        ),
        bone(
          "body",
          ground,
          part({
            9: "g9-11 c12-24",
            10: "g9-11 c12-24",
            11: "g8-10 c11-25",
            12: "g10-12 c13-24",
            13: "g9-13 y9 c14-22",
            14: "g8-13 y9-10 c14-22",
            15: "g8-12 y8-9 c13-22",
            16: "g7-12 c13-22",
            // From here down the book covers most of it.
            17: "g6-20",
            18: "g6-20",
            19: "g6-20",
            20: "g6-18 c12-13",
            21: "g6-18 c13-14",
            22: "g6-12 c13-16",
          }),
          bone(
            "head",
            at(17, 11),
            part({
              0: "g14-20",
              1: "g12-23 y14-18 y21",
              2: "g10-24 y12-13",
              3: "g9-25 y11-14",
              4: "g8-26",
              5: "g8-26",
              6: "g7-26",
              7: "g7-26",
              8: "g7-26",
              9: "g7-26",
              10: "g8-25",
            }),
            eyes([16.85, 5.9, 1.4, 2.4], [24.6, 5.9, 1.4, 2.4]),
            bone(
              "glasses",
              undefined,
              part({
                4: "d16-18 d24-26",
                5: "d15 d19 d23 d27",
                6: "d10-14 d20 d22 d28",
                7: "d14 d20-22 d28",
                8: "d14 d20 d22 d28",
                9: "d15 d19 d23 d27",
                10: "d16-18 d24-26",
              }),
            ),
          ),
        ),
        bone(
          "book",
          at(22, 19),
          part(
            {
              // Cream page edges along the top of each half.
              14: "c17-18 c27-28",
              15: "k16-18 c19-21 c25-27 k28-29",
              16: "k16-20 c21-22 c24-25 k26-29",
              17: "k16-22 c23 k24-28",
              18: "k16-27",
              19: "k16-27",
              20: "k15-27",
              21: "k15-27",
              22: "k17-24",
              23: "k20-22",
            },
            "k",
          ),
          // The page being turned.
          bone("leaf", undefined, part({ 15: "c25-26", 16: "c24-25", 17: "c24" })),
          bone(
            "paws",
            undefined,
            part({ 14: "g21-22", 15: "g22-23", 16: "g23", 18: "g28", 19: "g28" }),
          ),
        ),
      ),
    ],
  };
}

// ── building: hard hat on, a spanner in one paw ─────────────────────────
function building(): XiieArt {
  const { at, part, eyes, tail } = sheet(2, 2);
  const ground = at(15, 28);
  return {
    width: 39,
    height: 31,
    top: at(19, -2),
    bones: [
      bone(
        "root",
        ground,
        undefined,
        tail(
          [
            {
              19: "g0-4",
              20: "g0-7 y6-7",
              21: "g1-8 y5-6",
              22: "g1-8",
              23: "g3-8",
              24: "g4-8",
            },
            {
              14: "g1-3",
              15: "g0-3",
              16: "g0-3",
              17: "g0-3 y3",
              18: "g0-3 y2-3",
              19: "g0-4",
              20: "g0-4",
            },
            { 11: "g3-7", 12: "g2-5", 13: "g1-4", 14: "g1-3 y3" },
          ],
          [at(8, 22), at(2.5, 19.5), at(2, 14.5)],
        ),
        bone(
          "body",
          ground,
          part({
            12: "g12-14 c15-26",
            13: "g12-14 c15-26",
            14: "g11-13 c14-27",
            15: "g12-13 c14-26",
            16: "g13-15 c16-24",
            17: "g12-16 y12-13 c17-23 g24-25",
            18: "g10-16 y11-12 c17-22 g23-24",
            19: "g9-16 y10-11 c17-22 g23-24",
            20: "g6-17 y6-7 c18-22 g23-24",
            21: "g5-18 y5-6 c19-22 g23",
            22: "g5-18 c19-21 g22-23",
            23: "g5-13 c14-15 g16-18 c19-21 g22-23",
            24: "g5-12 c13-19 g20-23",
            25: "g8-11 c12-17 g18-23",
            26: "g7-13 g18-25",
            27: "g7-13 g19-24",
          }),
          bone(
            "head",
            at(19, 14.5),
            part({
              6: "g12-27",
              7: "g12-27",
              8: "g12-27",
              9: "g11-28",
              10: "g10-28",
              11: "g10-28",
              12: "g10-28",
              13: "g10-27",
              14: "g11-18",
            }),
            eyes([19, 9.3, 1.4, 2.6], [25.9, 9.3, 1.4, 2.6]),
            bone(
              "hat",
              at(19, 8),
              part(
                {
                  0: "d16-21",
                  1: "d14-17 b18-20 d21-23",
                  2: "d13 b14-17 d18 b19-21 d22 b23 d24",
                  3: "d12 b13-18 d19 b20-22 d23 b24 d25",
                  4: "d11 b12-19 d20 b21-22 d23 b24-25 d26",
                  5: "d10 b11-19 d20 b21-25 d26-27",
                  6: "d10 b11-27 d28",
                  7: "d10 b11-15 d16-28",
                  8: "d9 b10-12 d13-15",
                  9: "d9-12",
                },
                "d",
              ),
            ),
          ),
          // The arm reaches behind the spanner; the fist closes over it.
          bone(
            "arm",
            at(23.5, 19),
            part({
              17: "g24-25",
              18: "g23-30",
              19: "g23-30",
              20: "g23-24 g29-30",
            }),
            bone(
              "spanner",
              undefined,
              part({
                12: "p30-31",
                13: "p29-31 p34",
                14: "p29-31 p34",
                15: "p30-34",
                16: "p29-33",
                17: "p28-31",
                18: "p27-28",
                19: "p27",
                20: "p25-28",
                21: "p25 p27-28",
                22: "p25-27",
              }),
            ),
            bone("fist", undefined, part({ 18: "g29-30", 19: "g28-30", 20: "g29-30" })),
          ),
        ),
      ),
    ],
  };
}

/** What floats up when Xiie is poked, drawn about the point it rises from. */
export const XIIE_PUFFS = {
  heart: paint({ 0: "h0-1 h3-4", 1: "h0-4", 2: "h1-3", 3: "h2" }, -2, -5),
  note: paint({ 0: "p2-3", 1: "p2", 2: "p2", 3: "p0-2", 4: "p0-1" }, -2, -6),
  star: paint({ 0: "b1", 1: "b0-2", 2: "b1" }, -1, -4),
  bang: paint({ 0: "p0", 1: "p0", 2: "p0", 4: "p0" }, 0, -6),
};
export type XiiePuff = keyof typeof XIIE_PUFFS;

export const XIIE_ART = {
  idea: idea(),
  thinking: thinking(),
  reading: reading(),
  focus: focus(),
  coding: coding(),
  building: building(),
  running: running(),
  debugging: debugging(),
  done: done(),
  sleeping: sleeping(),
};
export type XiiePose = keyof typeof XIIE_ART;
export const XIIE_POSES = Object.keys(XIIE_ART) as XiiePose[];
