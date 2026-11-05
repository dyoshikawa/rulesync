import { AsyncLocalStorage } from "node:async_hooks";

import type { AiDirFile } from "../../types/ai-dir.js";

/**
 * What `RulesyncSkill.fromDir` read and parsed for one skill directory.
 */
export type LoadedRulesyncSkill = {
  frontmatter: Record<string, unknown>;
  body: string;
  otherFiles: AiDirFile[];
};

/**
 * Skill directories `RulesyncSkill.fromDir` already loaded, remembered for
 * the rest of a {@link withRulesyncSkillCache} scope and keyed by the skill
 * directory's path.
 *
 * A generate run builds one skills processor per target, and each processor
 * loaded every source skill again, so a project with dozens of skills read,
 * walked and parsed each skill directory once per target. The source trees
 * are inputs the run only reads, so a skill loaded once reads the same for
 * the rest of the run. A failed load is remembered too and fails the same way
 * on every later call.
 *
 * This lives in its own module, importing nothing of rulesync's at runtime, so
 * tests that mock `rulesync-skill.js` wholesale still run inside the scope.
 */
const loadedSkills = new AsyncLocalStorage<Map<string, Promise<LoadedRulesyncSkill>>>();

/**
 * Load the skill at `skillDirPath` with `load`, or reuse what the current
 * scope already loaded from there. Outside a scope every call loads afresh.
 */
export async function loadRulesyncSkillOnce({
  skillDirPath,
  load,
}: {
  skillDirPath: string;
  load: () => Promise<LoadedRulesyncSkill>;
}): Promise<LoadedRulesyncSkill> {
  const cache = loadedSkills.getStore();
  if (cache === undefined) {
    return await load();
  }
  let loaded = cache.get(skillDirPath);
  if (loaded === undefined) {
    loaded = load();
    cache.set(skillDirPath, loaded);
  }
  return await loaded;
}

/**
 * Run `operation` with `RulesyncSkill.fromDir` loading each skill directory
 * at most once.
 */
export async function withRulesyncSkillCache<T>(operation: () => Promise<T>): Promise<T> {
  return await loadedSkills.run(new Map(), operation);
}
