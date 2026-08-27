import { basename, join } from "node:path";

import {
  CURATED_SKILLS_FEATURE_SUBDIR,
  SKILLS_FEATURE_SUBDIR,
} from "../../constants/rulesync-paths.js";
import { directoryExistsStrict, listSubdirectoryNames } from "../../utils/file.js";

/**
 * Returns the set of local skill directory names (excluding `.curated`)
 * from a rulesync source tree (e.g. `/repo/.rulesync` or
 * `/repo/.rulesync.local`).
 */
export async function getLocalSkillDirNames(sourceTree: string): Promise<Set<string>> {
  const skillsDir = join(sourceTree, SKILLS_FEATURE_SUBDIR);
  const names = new Set<string>();

  // Strict: a source tree symlinked at a directory that no longer resolves
  // would otherwise enumerate to nothing, which reads as "every skill was
  // deleted" — `--delete` then removes what it could not regenerate.
  if (!(await directoryExistsStrict(skillsDir))) {
    return names;
  }

  for (const name of await listSubdirectoryNames(skillsDir)) {
    // Skip the .curated directory itself
    if (name === basename(CURATED_SKILLS_FEATURE_SUBDIR)) continue;
    names.add(name);
  }

  return names;
}

/**
 * Resolve the effective `disable-model-invocation` value for a tool skill.
 *
 * The rulesync skill frontmatter exposes a root-level `disable-model-invocation`
 * default that applies to every tool supporting the flag (claudecode, copilot,
 * copilotcli, cursor, zed, pi, qwencode, grokcli, factorydroid). Each tool's own section may override that
 * default with a per-target value. A defined section value (including `false`)
 * always wins over the root default.
 *
 * `devin` also consumes the root-level value — it maps `true` onto a user-only
 * `triggers` list (see `devin-skill.ts`) — but has no section key of the same
 * name, so it does not go through this helper. A `devin.triggers` section value
 * still overrides it.
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
 * that applies to every tool supporting the flag (claudecode, copilot,
 * copilotcli, cursor, qwencode, vibe, grokcli, factorydroid). Each tool's own section may override that default with a
 * per-target value. A defined section value (including `false`) always wins
 * over the root default.
 *
 * `devin` also consumes the root-level value — it maps `false` onto a
 * model-only `triggers` list (see `devin-skill.ts`) — but has no section key of
 * the same name, so it does not go through this helper. A `devin.triggers`
 * section value still overrides it.
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
