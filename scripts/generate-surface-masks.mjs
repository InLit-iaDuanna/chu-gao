import { mkdir, writeFile } from "node:fs/promises";
import { getSvgPath } from "figma-squircle";

// Nine-slice masks keep the corner geometry and one-pixel stroke at any width.
const directory = new URL("../public/ui/surfaces/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const radius of [4, 8, 12, 20]) {
  const path = getSvgPath({
    width: 79,
    height: 79,
    cornerRadius: radius - 0.5,
    cornerSmoothing: 0.6,
  });
  for (const kind of ["fill", "stroke"]) {
    const paint =
      kind === "fill"
        ? 'fill="white" stroke="white" stroke-width="1"'
        : 'fill="none" stroke="white" stroke-width="1"';
    await writeFile(
      new URL(`${radius}-${kind}.svg`, directory),
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><path transform="translate(.5 .5)" d="${path}" ${paint}/></svg>\n`,
    );
  }
}
