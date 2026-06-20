import { basename, join } from "node:path";

import {
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { directoryExists, findFilesByGlobs } from "../../utils/file.js";

/**
 * Returns the set of local skill directory names (excluding `.curated`).
 */
export async function getLocalSkillDirNames(outputRoot: string): Promise<Set<string>> {
  const skillsDir = join(outputRoot, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
  const names = new Set<string>();

  if (!(await directoryExists(skillsDir))) {
    return names;
  }

  const dirPaths = await findFilesByGlobs(join(skillsDir, "*"), { type: "dir" });
  for (const dirPath of dirPaths) {
    const name = basename(dirPath);
    // Skip the .curated directory itself
    if (name === basename(RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH)) continue;
    names.add(name);
  }

  return names;
}

/**
 * Resolve the effective `disable-model-invocation` value for a tool skill.
 *
 * The rulesync skill frontmatter exposes a root-level `disable-model-invocation`
 * default that applies to every tool supporting the flag (claudecode, cursor,
 * zed, pi, qwencode, factorydroid). Each tool's own section may override that
 * default with a per-target value. A defined section value (including `false`)
 * always wins over the root default.
 *
 * @returns The resolved boolean, or `undefined` when neither value is set.
 */
export function resolveDisableModelInvocation({
  rootFrontmatter,
  section,
}: {
  rootFrontmatter: { "disable-model-invocation"?: boolean };
  section: { "disable-model-invocation"?: boolean } | undefined;
}): boolean | undefined {
  return section?.["disable-model-invocation"] ?? rootFrontmatter["disable-model-invocation"];
}

/**
 * Resolve the effective `user-invocable` value for a tool skill.
 *
 * The rulesync skill frontmatter exposes a root-level `user-invocable` default
 * that applies to every tool supporting the flag (claudecode, qwencode, vibe,
 * factorydroid). Each tool's own section may override that default with a
 * per-target value. A defined section value (including `false`) always wins
 * over the root default.
 *
 * @returns The resolved boolean, or `undefined` when neither value is set.
 */
export function resolveUserInvocable({
  rootFrontmatter,
  section,
}: {
  rootFrontmatter: { "user-invocable"?: boolean };
  section: { "user-invocable"?: boolean } | undefined;
}): boolean | undefined {
  return section?.["user-invocable"] ?? rootFrontmatter["user-invocable"];
}
