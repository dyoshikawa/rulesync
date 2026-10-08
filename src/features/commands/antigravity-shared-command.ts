import { join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { resolveAntigravityCommandSkillName } from "./antigravity-command-skill-name.js";
import {
  AntigravityCommandFrontmatter,
  AntigravityCommandFrontmatterSchema,
} from "./antigravity-command.js";
import { rulesyncSkillNameExists } from "./command-skill-ownership.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

export type AntigravitySharedCommandParams = {
  frontmatter: AntigravityCommandFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Shared command generator for Google Antigravity 2.0 (IDE and CLI).
 *
 * Antigravity retires workflows on 2026-10-19 and documents skills as their
 * replacement: a skill is invoked as `/<skill-name>` exactly like a workflow
 * was, and takes precedence over a workflow of the same name. Each rulesync
 * command is therefore emitted as a skill, `<skills dir>/<name>/SKILL.md` with
 * `name`/`description` frontmatter, where `<name>` is the command's resolved
 * trigger (see {@link resolveAntigravityCommandSkillName}). A rulesync skill
 * with the same name wins: the command is skipped with a warning.
 *
 * {@link AntigravitySharedCommand.getSettablePaths} still returns the legacy
 * workflows directory, so `rulesync import` keeps reading existing workflow
 * files and `generate --delete` removes previously generated ones.
 *
 * Concrete subclasses supply the legacy workflows directories, the skills
 * directory and the rulesync target name they answer to.
 *
 * @see https://antigravity.google/docs/migration/workflows-to-skills
 * @see https://antigravity.google/docs/skills
 */
export class AntigravitySharedCommand extends ToolCommand {
  protected readonly frontmatter: AntigravityCommandFrontmatter;
  protected readonly body: string;

  constructor({ frontmatter, body, ...rest }: AntigravitySharedCommandParams) {
    if (rest.validate) {
      const result = AntigravityCommandFrontmatterSchema.safeParse(frontmatter);
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

  /** Project-scope workflows directory (e.g. `.agents/workflows`). */
  protected static getProjectRelativeDirPath(): string {
    throw new Error("Please implement this method in the subclass.");
  }

  /** Global-scope workflows directory under `~/.gemini/` (e.g. `.gemini/antigravity/global_workflows`). */
  protected static getGlobalRelativeDirPath(): string {
    throw new Error("Please implement this method in the subclass.");
  }

  /** Skills directory the commands are emitted into (the skills feature's own tree). */
  protected static getSkillsRelativeDirPath(_params: { global: boolean }): string {
    throw new Error("Please implement this method in the subclass.");
  }

  /** The rulesync target name this command serializes back to. */
  protected getToolTargetName(): ToolTarget {
    throw new Error("Please implement this method in the subclass.");
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (global) {
      return { relativeDirPath: this.getGlobalRelativeDirPath() };
    }
    return { relativeDirPath: this.getProjectRelativeDirPath() };
  }

  /**
   * The emitted `<skills dir>/<name>/` directory, so a skills target sharing
   * that tree does not sweep it as an orphan skill.
   */
  override getClaimedDirPaths(): string[] {
    if (this.relativeFilePath !== SKILL_FILE_NAME) {
      return [];
    }
    return [join(this.outputRoot, this.relativeDirPath)];
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
      targets: [this.getToolTargetName()],
      description,
      ...(Object.keys(restFields).length > 0 && { antigravity: restFields }),
    };

    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  /**
   * A rulesync skill with the same name is written to the same
   * `<skills dir>/<name>/` directory, so it takes precedence over the command.
   */
  static async getWriteBlockReason({
    rulesyncCommand,
    inputRoots,
  }: {
    rulesyncCommand: RulesyncCommand;
    inputRoots: readonly string[];
  }): Promise<string | null> {
    const dirName = resolveAntigravityCommandSkillName(rulesyncCommand);
    if (await rulesyncSkillNameExists({ inputRoots, dirName })) {
      return "a rulesync skill with the same name is emitted to the same skill directory and takes precedence";
    }
    return null;
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): AntigravitySharedCommand {
    const name = resolveAntigravityCommandSkillName(rulesyncCommand);

    const body = rulesyncCommand
      .getBody()
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
      .trim();

    // Antigravity skills require a description; it is what the agent sees
    // when deciding whether to apply the skill.
    const antigravityFrontmatter: AntigravityCommandFrontmatter = {
      name,
      description: rulesyncCommand.getFrontmatter().description ?? `${name} command`,
    };

    return new this({
      outputRoot,
      frontmatter: antigravityFrontmatter,
      body,
      relativeDirPath: join(this.getSkillsRelativeDirPath({ global }), name),
      relativeFilePath: SKILL_FILE_NAME,
      fileContent: stringifyFrontmatter(body, antigravityFrontmatter),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = AntigravityCommandFrontmatterSchema.safeParse(this.frontmatter);
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

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<AntigravitySharedCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = AntigravityCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): AntigravitySharedCommand {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
