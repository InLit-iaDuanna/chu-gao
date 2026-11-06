import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(
  fileURLToPath(import.meta.resolve("@tldraw/assets/selfHosted")),
);
const destination = join(process.cwd(), "public", "comfyart-assets");
await mkdir(destination, { recursive: true });
for (const directory of ["fonts", "icons", "embed-icons", "translations"]) {
  await cp(join(source, directory), join(destination, directory), {
    recursive: true,
  });
}
console.log("Canvas assets prepared in public/comfyart-assets");
