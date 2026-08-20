import { basename, join } from "node:path";

import { COMMANDS_FEATURE_SUBDIR } from "../../constants/rulesync-paths.js";
import { findFilesByGlobs } from "../../utils/file.js";

/**
 * Slug used for the per-command `<slug>/SKILL.md` directory when a tool's
 * commands are emitted onto its skills surface (Devin, Hermes Agent).
 */
export function commandSlug(relativeFilePath: string): string {
  return basename(relativeFilePath, ".md").replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Whether a rulesync command exists whose slug matches `dirName` in any of
 * the configured input roots.
 *
 * `inputRoots[i]` is a source tree itself (e.g. `/repo/.rulesync` or
 * `/repo/.rulesync.local`), so commands live directly under
 * `<sourceTree>/commands/`.
 *
 * Used by the skills-surface `isDirOwned` hooks of tools whose commands are
 * emitted as `<slug>/SKILL.md` into the skills tree: a directory matching a
 * current command slug is owned by the commands feature, so the skills
 * feature must neither import it as a skill nor delete it as an orphan
 * skill. Once the command is removed from every source tree's `commands/`
 * directory, the directory stops matching and the skills feature cleans
 * it up as a regular orphan.
 */
export async function rulesyncCommandSlugExists({
  inputRoots,
  dirName,
}: {
  inputRoots: readonly string[];
  dirName: string;
}): Promise<boolean> {
  const perRootPaths = await Promise.all(
    inputRoots.map((root) => findFilesByGlobs(join(root, COMMANDS_FEATURE_SUBDIR, "**", "*.md"))),
  );

  return perRootPaths.flat().some((filePath) => commandSlug(basename(filePath)) === dirName);
}
