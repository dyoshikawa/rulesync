import { join } from "node:path";

import { z } from "zod/mini";

import {
  CODEIUM_WINDSURF_GLOBAL_WORKFLOWS_DIR_PATH,
  DEVIN_WORKFLOWS_DIR_PATH,
} from "../../constants/devin-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
// Devin "workflows" are the command surface for Cascade. Files are Markdown with
// optional YAML frontmatter; only `description` is documented (no other required fields).
export const DevinCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
});

export type DevinCommandFrontmatter = z.infer<typeof DevinCommandFrontmatterSchema>;

export type DevinCommandParams = {
  frontmatter: DevinCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Represents a Devin (Cascade, now Devin Desktop) workflow command.
 * Devin supports workflows in both project mode under .devin/workflows/
 * (preferred since the Devin Desktop rebrand; .devin/workflows/ is the
 * legacy fallback the tool still reads) and global mode under
 * ~/.codeium/windsurf/global_workflows/ (unchanged by the rebrand).
 */
export class DevinCommand extends ToolCommand {
  private readonly frontmatter: DevinCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: DevinCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = DevinCommandFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Devin workflows use different paths for project and global modes:
    // - Project mode: {process.cwd()}/.devin/workflows/ (preferred since the
    //   Devin Desktop rebrand; .devin/workflows/ is the legacy fallback)
    // - Global mode: {getHomeDirectory()}/.codeium/windsurf/global_workflows/
    if (global) {
      return {
        relativeDirPath: CODEIUM_WINDSURF_GLOBAL_WORKFLOWS_DIR_PATH,
      };
    }
    return {
      relativeDirPath: DEVIN_WORKFLOWS_DIR_PATH,
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
      // Preserve extra fields in devin section
      ...(Object.keys(restFields).length > 0 && { devin: restFields }),
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
  }: ToolCommandFromRulesyncCommandParams): DevinCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge devin-specific fields from rulesync frontmatter
    const devinFields = rulesyncFrontmatter.devin ?? {};

    const devinFrontmatter: DevinCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...devinFields,
    };

    // Generate proper file content with Devin specific frontmatter
    const body = rulesyncCommand.getBody();

    const paths = this.getSettablePaths({ global });

    return new DevinCommand({
      outputRoot: outputRoot,
      frontmatter: devinFrontmatter,
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

    const result = DevinCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "devin",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<DevinCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate required fields using DevinCommandFrontmatterSchema
    const result = DevinCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new DevinCommand({
      outputRoot: outputRoot,
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
  }: ToolCommandForDeletionParams): DevinCommand {
    return new DevinCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
