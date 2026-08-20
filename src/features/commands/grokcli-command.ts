import { basename, dirname, join } from "node:path";

import { z } from "zod/mini";

import { GROKCLI_COMMANDS_DIR_PATH } from "../../constants/grokcli-paths.js";
import { SKILLS_FEATURE_SUBDIR } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { findFilesByGlobs, readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

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
export const GrokcliCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
});

export type GrokcliCommandFrontmatter = z.infer<typeof GrokcliCommandFrontmatterSchema>;

export type GrokcliCommandParams = {
  frontmatter: GrokcliCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class GrokcliCommand extends ToolCommand {
  private readonly frontmatter: GrokcliCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: GrokcliCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = GrokcliCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes use the same relative dir; the processor supplies the home
    // directory as outputRoot in global mode.
    return {
      relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      // Preserve the Grok-only fields in the grokcli section
      ...(Object.keys(restFields).length > 0 && { grokcli: restFields }),
    };

    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: stringifyFrontmatter(this.body, rulesyncFrontmatter),
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): GrokcliCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // `user-invocable` / `disable-model-invocation` are read from the `grokcli`
    // section only, not from a shared root key the way `GrokcliSkill` reads
    // them: the canonical command frontmatter has no root-level equivalent (it
    // carries `targets` and `description` and nothing else), so this matches
    // how every other commands adapter handles its tool-only keys.
    const grokcliFields = rulesyncFrontmatter.grokcli ?? {};

    const grokcliFrontmatter: GrokcliCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...grokcliFields,
    };

    const paths = this.getSettablePaths({ global });

    return new GrokcliCommand({
      outputRoot,
      frontmatter: grokcliFrontmatter,
      body: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = GrokcliCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "grokcli",
    });
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
    const perRootSkillFiles = await Promise.all(
      inputRoots.map((root) =>
        findFilesByGlobs(join(root, SKILLS_FEATURE_SUBDIR, "**", "SKILL.md")),
      ),
    );
    const skillFiles = perRootSkillFiles.flat();
    const shadowed = skillFiles
      .map((filePath) => basename(dirname(filePath)))
      .filter((skillName) => commandNames.has(skillName));

    if (shadowed.length > 0) {
      logger.warn(
        `Grok CLI resolves skills before commands, so these skills shadow the same-named ` +
          `commands, which will never be reachable: ${[...new Set(shadowed)].toSorted().join(", ")}. ` +
          `Rename either side to make both invocable.`,
      );
    }
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<GrokcliCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = GrokcliCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new GrokcliCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): GrokcliCommand {
    return new GrokcliCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
