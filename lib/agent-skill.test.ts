import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createAgentSkillZip } from "@/lib/agent-skill";
describe("Agent Skill export", () => {
  it("only exports reviewed skill files and contains no runtime credentials", async () => {
    const entries = unzipSync(await createAgentSkillZip());
    expect(Object.keys(entries).sort()).toEqual([
      "chugao-image/SKILL.md",
      "chugao-image/references/api.md",
      "chugao-image/scripts/chugao.py",
    ]);
    const text = Object.values(entries)
      .map((entry) => strFromU8(entry))
      .join("\n");
    expect(text).not.toMatch(
      /sk-[a-f0-9]{30,}|cg_[A-Za-z0-9_-]{43}|DATABASE_URL=/,
    );
  });
});
