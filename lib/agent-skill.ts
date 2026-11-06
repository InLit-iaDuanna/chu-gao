import { readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

export async function createAgentSkillZip() {
  // Explicit entries keep local credentials, tests and build caches out of exports.
  const entries = ["SKILL.md", "scripts/chugao.py", "references/api.md"];
  const archive: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    const content = await readFile(
      path.join(process.cwd(), "resources/chugao-image", entry),
      "utf8",
    );
    archive[`chugao-image/${entry}`] = strToU8(content);
  }
  return zipSync(archive);
}
