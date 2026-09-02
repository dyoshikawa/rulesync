import { basename, join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  CURATED_SKILLS_FEATURE_SUBDIR,
  SKILLS_FEATURE_SUBDIR,
} from "../../constants/rulesync-paths.js";
import { containsPathSeparator } from "../../types/ai-dir.js";
import {
  directoryExists,
  directoryExistsStrict,
  fileExists,
  listSubdirectoryNames,
} from "../../utils/file.js";

/**
 * Whether a directory on disk can be addressed by its name.
 *
 * `AiDir` refuses a name holding a path separator, and rightly so: most tools
 * take that name from a skill's frontmatter, and a repository written on one
 * platform is read on the other, where a backslash is a separator. POSIX still
 * lets a directory be *created* with a backslash in its name, so such a
 * directory can sit in a skills root that nothing here can name — it is
 * reported rather than passed on, since the alternative is a candidate built
 * from a name that belongs to no directory at all. The test is `AiDir`'s own,
 * so this pre-filter cannot come to accept a name the guard behind it throws
 * over.
 */
export function isAddressableSkillName(name: string): boolean {
  return !containsPathSeparator(name);
}

/**
 * The names of the skill directories directly under `skillsRoot`.
 *
 * A `**` glob for `SKILL.md` cannot stand in for this on two counts. It reads a
 * backslash as a path separator, so a directory literally named `back\\slash`
 * yields the two-segment name `back/slash`, which no `AiDir` accepts — and a
 * `SKILL.md` nested deeper inside a skill yields a two-segment name for the
 * same reason. Both turn a validation pass into a hard failure over a skill the
 * skills processor itself only reports and skips.
 *
 * A root that does not exist is an empty root, matching what the glob returned.
 */
export async function listSkillDirNames(skillsRoot: string): Promise<string[]> {
  if (!(await directoryExists(skillsRoot))) {
    return [];
  }
  const names = await listSubdirectoryNames(skillsRoot);
  const found = await Promise.all(
    names.map(async (name) =>
      isAddressableSkillName(name) && (await fileExists(join(skillsRoot, name, SKILL_FILE_NAME)))
        ? name
        : undefined,
    ),
  );
  return found.filter((name) => name !== undefined);
}

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

/**
 * Resolve the effective `license` value for a tool skill.
 *
 * The rulesync skill frontmatter exposes a root-level `license` default that
 * applies to every tool modelling the Agent Skills standard field; the list of
 * those tools lives in `docs/reference/file-formats.md`. Each tool's own
 * section may override that default with a per-target value. A defined section
 * value always wins over the root default.
 *
 * The section value type is generic because `factorydroid` deliberately types
 * the packaging fields as `unknown` (Droid never validates them).
 *
 * @returns The resolved value, or `undefined` when neither value is set.
 */
export function resolveLicense<TSection = string>({
  rootFrontmatter,
  section,
}: {
  rootFrontmatter: { license?: string };
  section: { license?: TSection } | undefined;
}): TSection | string | undefined {
  return section?.license ?? rootFrontmatter.license;
}

/**
 * Resolve the effective `compatibility` value for a tool skill.
 *
 * The rulesync skill frontmatter exposes a root-level `compatibility` default
 * that applies to every tool modelling the Agent Skills standard field; the
 * list of those tools lives in `docs/reference/file-formats.md`. Each tool's
 * own section may override that default with a per-target value. A defined
 * section value always wins over the root default.
 *
 * The root value keeps the rulesync shape (a string, or the legacy object
 * form); any per-target normalization — such as the Agent Skills spec's string
 * coercion — stays with the adapter.
 * The section value type is generic because `factorydroid` deliberately types
 * the packaging fields as `unknown` (Droid never validates them).
 *
 * @returns The resolved value, or `undefined` when neither value is set.
 */
export function resolveCompatibility<TSection = string | Record<string, unknown>>({
  rootFrontmatter,
  section,
}: {
  rootFrontmatter: { compatibility?: string | Record<string, unknown> };
  section: { compatibility?: TSection } | undefined;
}): TSection | string | Record<string, unknown> | undefined {
  return section?.compatibility ?? rootFrontmatter.compatibility;
}

/**
 * Resolve the effective `metadata` value for a tool skill.
 *
 * The rulesync skill frontmatter exposes a root-level `metadata` default that
 * applies to every tool modelling the Agent Skills standard field; the list of
 * those tools lives in `docs/reference/file-formats.md`. Each tool's own
 * section may override that default with a per-target value. A defined section
 * value always wins over the root default; the two maps are never merged key
 * by key.
 *
 * The section value type is generic because `factorydroid` deliberately types
 * the packaging fields as `unknown` (Droid never validates them).
 *
 * @returns The resolved value, or `undefined` when neither value is set.
 */
export function resolveMetadata<TSection = Record<string, unknown>>({
  rootFrontmatter,
  section,
}: {
  rootFrontmatter: { metadata?: Record<string, unknown> };
  section: { metadata?: TSection } | undefined;
}): TSection | Record<string, unknown> | undefined {
  return section?.metadata ?? rootFrontmatter.metadata;
}
