import { basename, join, relative } from "node:path";

import { COMMANDS_FEATURE_SUBDIR } from "../../constants/rulesync-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { findFilesByGlobs } from "../../utils/file.js";
import { RulesyncCommand } from "./rulesync-command.js";

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
 *
 * When `toolTarget` is given, only commands whose `targets` include it (or
 * `*`) count: a command aimed at other tools never reaches this tool's skills
 * tree, so it must not shadow a same-named skill there. Commands that cannot
 * be parsed are skipped, as the commands feature reports them itself.
 */
export async function rulesyncCommandSlugExists({
  inputRoots,
  dirName,
  toolTarget,
}: {
  inputRoots: readonly string[];
  dirName: string;
  toolTarget?: ToolTarget;
}): Promise<boolean> {
  const perRoot = await Promise.all(
    inputRoots.map(async (root) => {
      const commandsDirPath = join(root, COMMANDS_FEATURE_SUBDIR);
      const filePaths = await findFilesByGlobs("**/*.md", { cwd: commandsDirPath });
      return filePaths.map((filePath) => ({ root, commandsDirPath, filePath }));
    }),
  );
  const matching = perRoot
    .flat()
    .filter(({ filePath }) => commandSlug(basename(filePath)) === dirName);
  if (toolTarget === undefined) {
    return matching.length > 0;
  }

  for (const { root, commandsDirPath, filePath } of matching) {
    let targets: readonly string[];
    try {
      const rulesyncCommand = await RulesyncCommand.fromFile({
        outputRoot: root,
        relativeDirPath: COMMANDS_FEATURE_SUBDIR,
        relativeFilePath: relative(commandsDirPath, filePath),
      });
      targets = rulesyncCommand.getFrontmatter().targets;
    } catch {
      continue;
    }
    if (targets.includes("*") || targets.includes(toolTarget)) {
      return true;
    }
  }
  return false;
}
