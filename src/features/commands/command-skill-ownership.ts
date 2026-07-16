import { basename, join } from "node:path";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { findFilesByGlobs } from "../../utils/file.js";

/**
 * Slug used for the per-command `<slug>/SKILL.md` directory when a tool's
 * commands are emitted onto its skills surface (Devin, Hermes Agent).
 */
export function commandSlug(relativeFilePath: string): string {
  return basename(relativeFilePath, ".md").replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Whether a rulesync command exists whose slug matches `dirName`.
 *
 * Used by the skills-surface `isDirOwned` hooks of tools whose commands are
 * emitted as `<slug>/SKILL.md` into the skills tree: a directory matching a
 * current command slug is owned by the commands feature, so the skills
 * feature must neither import it as a skill nor delete it as an orphan
 * skill. Once the command is removed from `.rulesync/commands/`, the
 * directory stops matching and the skills feature cleans it up as a regular
 * orphan.
 */
export async function rulesyncCommandSlugExists({
  inputRoot,
  dirName,
}: {
  inputRoot: string;
  dirName: string;
}): Promise<boolean> {
  const commandFilePaths = await findFilesByGlobs(
    join(inputRoot, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "**", "*.md"),
  );
  return commandFilePaths.some((filePath) => commandSlug(basename(filePath)) === dirName);
}
