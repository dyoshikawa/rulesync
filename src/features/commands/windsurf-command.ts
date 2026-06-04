import { join } from "node:path";

import { z } from "zod/mini";

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
// Windsurf "workflows" are the command surface for Cascade. Files are Markdown with
// optional YAML frontmatter; only `description` is documented (no other required fields).
export const WindsurfCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
});

export type WindsurfCommandFrontmatter = z.infer<typeof WindsurfCommandFrontmatterSchema>;

export type WindsurfCommandParams = {
  frontmatter: WindsurfCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Represents a Windsurf (Cascade) workflow command.
 * Windsurf supports workflows in both project mode under .windsurf/workflows/
 * and global mode under ~/.codeium/windsurf/global_workflows/.
 */
export class WindsurfCommand extends ToolCommand {
  private readonly frontmatter: WindsurfCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: WindsurfCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = WindsurfCommandFrontmatterSchema.safeParse(frontmatter);
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
    // Windsurf workflows use different paths for project and global modes:
    // - Project mode: {process.cwd()}/.windsurf/workflows/
    // - Global mode: {getHomeDirectory()}/.codeium/windsurf/global_workflows/
    if (global) {
      return {
        relativeDirPath: join(".codeium", "windsurf", "global_workflows"),
      };
    }
    return {
      relativeDirPath: join(".windsurf", "workflows"),
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
      // Preserve extra fields in windsurf section
      ...(Object.keys(restFields).length > 0 && { windsurf: restFields }),
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
  }: ToolCommandFromRulesyncCommandParams): WindsurfCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge windsurf-specific fields from rulesync frontmatter
    const windsurfFields = rulesyncFrontmatter.windsurf ?? {};

    const windsurfFrontmatter: WindsurfCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...windsurfFields,
    };

    // Generate proper file content with Windsurf specific frontmatter
    const body = rulesyncCommand.getBody();

    const paths = this.getSettablePaths({ global });

    return new WindsurfCommand({
      outputRoot: outputRoot,
      frontmatter: windsurfFrontmatter,
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

    const result = WindsurfCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "windsurf",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<WindsurfCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate required fields using WindsurfCommandFrontmatterSchema
    const result = WindsurfCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new WindsurfCommand({
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
  }: ToolCommandForDeletionParams): WindsurfCommand {
    return new WindsurfCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
