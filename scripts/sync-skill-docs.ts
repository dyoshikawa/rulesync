import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Keep the distributed `skills/rulesync/` skill down to its single
 * hand-authored `SKILL.md`.
 *
 * Earlier versions mirrored the whole VitePress `docs/` hierarchy into the
 * skill as flat Markdown files. Since the `rulesync docs` command exposes the
 * bundled documentation directly (lookup and search), the skill only needs
 * `SKILL.md`, which instructs agents to consult `rulesync docs`. This script
 * prunes any other file so the mirrored tree cannot creep back in.
 */
const SKILL_FILE_NAME = "SKILL.md";

export function syncSkillDocs(): { removed: string[] } {
  const skillDir = join(process.cwd(), "skills", "rulesync");
  if (!existsSync(join(skillDir, SKILL_FILE_NAME))) {
    throw new Error(`${join(skillDir, SKILL_FILE_NAME)} is missing; the skill must ship it.`);
  }
  const removed: string[] = [];
  for (const entry of readdirSync(skillDir)) {
    if (entry === SKILL_FILE_NAME) {
      continue;
    }
    rmSync(join(skillDir, entry), { recursive: true, force: true });
    removed.push(entry);
  }
  return { removed };
}

function main(): void {
  const { removed } = syncSkillDocs();
  // oxlint-disable-next-line no-console
  console.log(
    removed.length > 0
      ? `Pruned ${removed.length} stale file(s) from skills/rulesync/ (only SKILL.md is distributed).`
      : "skills/rulesync/ already contains only SKILL.md.",
  );
}

const entryPointPath = process.argv[1];
if (entryPointPath && fileURLToPath(import.meta.url) === entryPointPath) {
  main();
}
