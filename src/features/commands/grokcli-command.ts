import { basename, join } from "node:path";

import { z } from "zod/mini";

import { GROKCLI_COMMANDS_DIR_PATH } from "../../constants/grokcli-paths.js";
import { SKILLS_FEATURE_SUBDIR } from "../../constants/rulesync-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import type { Logger } from "../../utils/logger.js";
import { listSkillDirNames } from "../skills/skills-utils.js";
import {
  FrontmatterMarkdownToolCommand,
  type FrontmatterMarkdownToolCommandParams,
} from "./frontmatter-markdown-command.js";
import type { RulesyncCommand } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * Grok CLI custom slash commands are Markdown files under `.grok/commands/`
 * (project) / `~/.grok/commands/` (global), discovered by the same
 * Claude-Code-compatible frontmatter parser Grok uses for skills.
 *
 * Two upstream constraints shape this adapter:
 *
 * - The scan is **flat and non-recursive**, so nested namespacing is not
 *   modelled (`supportsSubdirectory: false` flattens nested rulesync commands
 *   onto their basename).
 * - Skills are collected before commands and win name collisions, so a
 *   `.grok/skills/<name>/` shadows `.grok/commands/<name>.md`.
 *
 * `description` and `argument-hint` describe the command, while
 * `user-invocable` (default true) and `disable-model-invocation` (default
 * false) control who may invoke it — the same pair `GrokcliSkill` emits.
 * @see https://docs.x.ai/build/features/skills-plugins-marketplaces
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const GrokcliCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
});

export type GrokcliCommandFrontmatter = z.infer<typeof GrokcliCommandFrontmatterSchema>;

export type GrokcliCommandParams = FrontmatterMarkdownToolCommandParams<GrokcliCommandFrontmatter>;

export class GrokcliCommand extends FrontmatterMarkdownToolCommand<GrokcliCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes use the same relative dir; the processor supplies the home
    // directory as outputRoot in global mode.
    return {
      relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
    };
  }

  // `user-invocable` / `disable-model-invocation` are read from the `grokcli`
  // section only, not from a shared root key the way `GrokcliSkill` reads
  // them: the canonical command frontmatter has no root-level equivalent (it
  // carries `targets` and `description` and nothing else), so this matches
  // how every other commands adapter handles its tool-only keys.
  protected static override getToolTarget(): ToolTarget {
    return "grokcli";
  }

  protected static override getFrontmatterSchema() {
    return GrokcliCommandFrontmatterSchema;
  }

  /**
   * Warn when a rulesync skill would shadow a rulesync command.
   *
   * Grok collects skills before commands and lets skills win name collisions,
   * so `.grok/skills/<name>/` makes `.grok/commands/<name>.md` unreachable.
   * Both files are still written correctly — nothing is overwritten and no
   * output is lost — so this warns rather than failing the run the way the
   * Hermes check does, where the two surfaces really do write the same path.
   */
  static async validateRulesyncCommands({
    inputRoots,
    rulesyncCommands,
    logger,
  }: {
    inputRoots: readonly string[];
    rulesyncCommands: RulesyncCommand[];
    logger: Logger;
  }): Promise<void> {
    const commandNames = new Set(
      rulesyncCommands
        .filter((command) => this.isTargetedByRulesyncCommand(command))
        // The scan is flat, so the reachable name is always the basename.
        .map((command) => basename(command.getRelativeFilePath(), ".md")),
    );
    if (commandNames.size === 0) return;

    // Skills from any input root can shadow the command, so scan them all;
    // duplicates by directory name are naturally deduped via the Set below.
    // Read rather than globbed, so a skill directory whose name holds a
    // backslash is compared under the name it has on disk instead of the
    // trailing segment a glob rewrites it into.
    const perRootSkillNames = await Promise.all(
      inputRoots.map((root) => listSkillDirNames(join(root, SKILLS_FEATURE_SUBDIR))),
    );
    const shadowed = perRootSkillNames.flat().filter((skillName) => commandNames.has(skillName));

    if (shadowed.length > 0) {
      logger.warn(
        `Grok CLI resolves skills before commands, so these skills shadow the same-named ` +
          `commands, which will never be reachable: ${[...new Set(shadowed)].toSorted().join(", ")}. ` +
          `Rename either side to make both invocable.`,
      );
    }
  }
}
