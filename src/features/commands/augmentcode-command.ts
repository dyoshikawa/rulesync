import { isAbsolute, join, relative } from "node:path";

import { z } from "zod/mini";

import {
  AUGMENTCODE_AGENTS_COMMANDS_DIR_PATH,
  AUGMENTCODE_COMMANDS_DIR_PATH,
} from "../../constants/augmentcode-paths.js";
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

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const AugmentcodeCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  // Augment Code custom commands also support `argument-hint` and `model`
  // frontmatter fields. https://docs.augmentcode.com/cli/custom-commands
  "argument-hint": z.optional(z.string()),
  model: z.optional(z.string()),
});

export type AugmentcodeCommandFrontmatter = z.infer<typeof AugmentcodeCommandFrontmatterSchema>;

export type AugmentcodeCommandParams = {
  frontmatter: AugmentcodeCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class AugmentcodeCommand extends ToolCommand {
  private readonly frontmatter: AugmentcodeCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: AugmentcodeCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = AugmentcodeCommandFrontmatterSchema.safeParse(frontmatter);
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
    // Augment Code reads custom commands from `.augment/commands/<name>.md` for the
    // project/workspace scope and `~/.augment/commands/<name>.md` for the user/global
    // scope. The relative directory is the same in both cases; the global scope is
    // home-rooted by the processor through the outputRoot.
    return {
      relativeDirPath: AUGMENTCODE_COMMANDS_DIR_PATH,
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
      // Preserve extra fields in augmentcode section
      ...(Object.keys(restFields).length > 0 && { augmentcode: restFields }),
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: process.cwd(), // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): AugmentcodeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge augmentcode-specific fields from rulesync frontmatter
    const augmentcodeFields = rulesyncFrontmatter.augmentcode ?? {};

    const augmentcodeFrontmatter: AugmentcodeCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...augmentcodeFields,
    };

    // Generate proper file content with Augment Code specific frontmatter
    const body = rulesyncCommand.getBody();

    const paths = this.getSettablePaths({ global });

    return new AugmentcodeCommand({
      outputRoot: outputRoot,
      frontmatter: augmentcodeFrontmatter,
      body,
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

    const result = AugmentcodeCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "augmentcode",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<AugmentcodeCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate required fields using AugmentcodeCommandFrontmatterSchema
    const result = AugmentcodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new AugmentcodeCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  /**
   * Import-only: the commands Auggie also loads from the cross-tool
   * `.agents/commands/` root. Generation stays on `.augment/commands/`, so this
   * root is read but never written to — and never swept for orphans, since the
   * files there may belong to another tool.
   *
   * @see https://docs.augmentcode.com/cli/custom-commands
   */
  static async loadAdditionalImportFiles({
    outputRoot = process.cwd(),
    global = false,
    logger,
  }: {
    outputRoot?: string;
    global?: boolean;
    logger?: Logger;
  } = {}): Promise<AugmentcodeCommand[]> {
    const rootDir = join(outputRoot, AUGMENTCODE_AGENTS_COMMANDS_DIR_PATH);
    const filePaths = await findFilesByGlobs(join(rootDir, "**", "*.md"));
    if (filePaths.length > 0) {
      // `.agents/commands/` is a cross-tool root — rulesync writes it for
      // `agentsmd` too — so say where these came from: importing one makes it a
      // rulesync command targeting every tool.
      logger?.warn(
        `Importing ${filePaths.length} AugmentCode command(s) from the shared ` +
          `${AUGMENTCODE_AGENTS_COMMANDS_DIR_PATH} root; they will be written for every target ` +
          `on the next generate.`,
      );
    }

    const commands = await Promise.all(
      filePaths.map(async (filePath) => {
        const relativePath = relative(rootDir, filePath);
        // Same guard the processor applies to its own root: a project path
        // holding glob metacharacters can make globby match a sibling tree.
        if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
          logger?.warn(`Skipping ${filePath}: it resolves outside ${rootDir}.`);
          return undefined;
        }
        const fileContent = await readFileContent(filePath);
        const { frontmatter, body } = parseFrontmatter(fileContent, filePath);
        const result = AugmentcodeCommandFrontmatterSchema.safeParse(frontmatter);
        if (!result.success) {
          // This root is shared with other tools, whose frontmatter conventions
          // differ (Claude Code writes `argument-hint: [message]`, a list). One
          // such file must not take the whole import down.
          logger?.warn(
            `Skipping ${filePath}: it does not carry AugmentCode command frontmatter ` +
              `(${formatError(result.error)}).`,
          );
          return undefined;
        }
        return new AugmentcodeCommand({
          outputRoot,
          // The rulesync-side path is the same either way: the command's name is
          // its path under the commands root, whichever root it came from.
          relativeDirPath: AUGMENTCODE_COMMANDS_DIR_PATH,
          // Native separators, matching what the processor's own loader
          // produces — the duplicate check compares these strings, and a posix
          // path would miss a collision on Windows.
          relativeFilePath: relativePath,
          frontmatter: result.data,
          body: body.trim(),
          global,
        });
      }),
    );
    return commands.filter((command) => command !== undefined);
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): AugmentcodeCommand {
    return new AugmentcodeCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
