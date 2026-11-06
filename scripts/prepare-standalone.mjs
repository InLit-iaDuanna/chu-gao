import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const distDir = process.env.NEXT_DIST_DIR || ".next";
const standalone = path.join(root, distDir, "standalone");
const sourceNext = path.dirname(require.resolve("next/package.json"));
const targetNext = await realpath(
  path.join(standalone, "node_modules", "next"),
);
if (!targetNext.startsWith(`${standalone}${path.sep}`))
  throw new Error(
    "Refusing to copy dependencies outside the generated standalone directory.",
  );

async function copyRuntime(source, target, omitTypes = false) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (omitTypes && /\.(?:d\.(?:[cm]?ts)|map)$/.test(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const info = await stat(from);
    if (info.isDirectory()) await copyRuntime(from, to, omitTypes);
    else if (info.isFile()) {
      // Reading hydrates macOS File Provider placeholders; copyfile can time out
      // on those files without ever opening their contents.
      try {
        await writeFile(to, await readFile(from));
      } catch (error) {
        throw new Error(`Could not materialize runtime dependency ${from}`, {
          cause: error,
        });
      }
      await chmod(to, info.mode & 0o777);
    }
  }
}

// Next 15's trace omits dynamic framework imports with this pnpm installation.
// Keep local starts and Docker images on the same complete runtime package.
await copyRuntime(sourceNext, targetNext, true);
const staticTarget = path.join(standalone, distDir, "static");
await rm(staticTarget, { recursive: true, force: true });
await mkdir(path.dirname(staticTarget), { recursive: true });
await copyRuntime(path.join(root, distDir, "static"), staticTarget);
const publicSource = path.join(root, "public");
if (
  await stat(publicSource)
    .then((value) => value.isDirectory())
    .catch(() => false)
) {
  await rm(path.join(standalone, "public"), { recursive: true, force: true });
  await copyRuntime(publicSource, path.join(standalone, "public"));
}
// Deployment configuration belongs to the runtime environment, not the bundle.
for (const entry of ["SKILL.md", "scripts/chugao.py", "references/api.md"]) {
  const destination = path.join(standalone, "resources", "chugao-image", entry);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(path.join(root, "resources", "chugao-image", entry)));
}
for (const name of await readdir(standalone)) {
  if (name === ".env" || name.startsWith(".env."))
    await rm(path.join(standalone, name), { force: true });
}
console.log(
  "Standalone runtime prepared: framework, static and public assets; no environment files.",
);
