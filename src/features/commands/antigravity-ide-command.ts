import { basename, join } from "node:path";

import {
  ANTIGRAVITY_IDE_COMMANDS_DIR_PATH,
  ANTIGRAVITY_IDE_GLOBAL_WORKFLOWS_DIR_PATH,
  ANTIGRAVITY_IDE_PRE_V2_GLOBAL_WORKFLOWS_DIR_PATH,
} from "../../constants/antigravity-ide-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { findFilesByGlobs, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import type { Logger } from "../../utils/logger.js";
import { AntigravityIdeSkill } from "../skills/antigravity-ide-skill.js";
import { AntigravityCommandFrontmatterSchema } from "./antigravity-command.js";
import { AntigravitySharedCommand } from "./antigravity-shared-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * Command generator for the Google Antigravity IDE (Antigravity 2.0).
 *
 * Emits each command as a skill in `.agents/skills/<name>/SKILL.md` (project
 * scope) and `~/.gemini/config/skills/<name>/SKILL.md` (global scope), the
 * IDE's skills directories. Legacy workflows are still imported from
 * `.agents/workflows/` and `~/.gemini/config/workflows/` (the global workflows
 * directory of Antigravity 2.0), and, in global scope only, from the pre-2.0
 * `~/.gemini/antigravity/global_workflows/`. All body and frontmatter handling
 * is shared with {@link AntigravitySharedCommand}.
 */
export class AntigravityIdeCommand extends AntigravitySharedCommand {
  protected static override getProjectRelativeDirPath(): string {
    return ANTIGRAVITY_IDE_COMMANDS_DIR_PATH;
  }

  protected static override getGlobalRelativeDirPath(): string {
    return ANTIGRAVITY_IDE_GLOBAL_WORKFLOWS_DIR_PATH;
  }

  protected static override getSkillsRelativeDirPath({ global }: { global: boolean }): string {
    return AntigravityIdeSkill.getSettablePaths({ global }).relativeDirPath;
  }

  /**
   * Import-only, global scope: the workflows left in the pre-2.0
   * `~/.gemini/antigravity/global_workflows/` directory, where rulesync also
   * wrote IDE global commands before they were emitted as skills. The
   * directory is never swept by `generate --delete`; a workflow with the same
   * file name in `~/.gemini/config/workflows/` takes precedence.
   *
   * @see https://antigravity.google/docs/migration/workflows-to-skills
   */
  static async loadAdditionalImportFiles({
    outputRoot = process.cwd(),
    global = false,
    logger,
  }: {
    outputRoot?: string;
    global?: boolean;
    logger?: Logger;
  } = {}): Promise<AntigravityIdeCommand[]> {
    if (!global) {
      return [];
    }
    const rootDir = join(outputRoot, ANTIGRAVITY_IDE_PRE_V2_GLOBAL_WORKFLOWS_DIR_PATH);
    const filePaths = await findFilesByGlobs("*.md", { cwd: rootDir });

    const commands = await Promise.all(
      filePaths.map(async (filePath) => {
        const fileContent = await readFileContent(filePath);
        const { frontmatter, body } = parseFrontmatter(fileContent, filePath);
        const result = AntigravityCommandFrontmatterSchema.safeParse(frontmatter);
        if (!result.success) {
          logger?.warn(`Skipping ${filePath}: invalid frontmatter (${formatError(result.error)}).`);
          return undefined;
        }
        return new AntigravityIdeCommand({
          outputRoot,
          relativeDirPath: ANTIGRAVITY_IDE_PRE_V2_GLOBAL_WORKFLOWS_DIR_PATH,
          relativeFilePath: basename(filePath),
          frontmatter: result.data,
          body: body.trim(),
          fileContent,
          global,
        });
      }),
    );
    return commands.filter((command) => command !== undefined);
  }

  protected override getToolTargetName(): ToolTarget {
    return "antigravity-ide";
  }

  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "antigravity-ide",
    });
  }
}
