import { basename, join } from "node:path";

import { z } from "zod/mini";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const AntigravityWorkflowFrontmatterSchema = z.looseObject({
  trigger: z.optional(z.string()),
  turbo: z.optional(z.boolean()),
});

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const AntigravityCommandFrontmatterSchema = z.looseObject({
  description: z.string(),
  // Support for workflow-specific configuration
  ...AntigravityWorkflowFrontmatterSchema.shape,
});

export type AntigravityCommandFrontmatter = z.infer<typeof AntigravityCommandFrontmatterSchema>;

export type AntigravityCommandParams = {
  frontmatter: AntigravityCommandFrontmatter;
  body: string;
} & AiFileParams;

export type AntigravityCommandSettablePaths = {
  relativeDirPath: string;
};

/**
 * Command generator for Google Antigravity IDE
 *
 * Generates workflow files for Antigravity's .agent/workflows/ directory.
 */
export class AntigravityCommand extends ToolCommand {
  private readonly frontmatter: AntigravityCommandFrontmatter;
  private readonly body: string;

  static getSettablePaths(): AntigravityCommandSettablePaths {
    return {
      relativeDirPath: join(".agent", "workflows"),
    };
  }

  constructor({ frontmatter, body, ...rest }: AntigravityCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
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

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["antigravity"],
      description,
      // Preserve extra fields in antigravity section
      ...(Object.keys(restFields).length > 0 && { antigravity: restFields }),
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: ".", // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  private static extractAntigravityConfig(
    rulesyncCommand: RulesyncCommand,
  ): Record<string, unknown> | undefined {
    const antigravity = rulesyncCommand.getFrontmatter().antigravity;
    return isRecord(antigravity) ? antigravity : undefined;
  }

  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): AntigravityCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const antigravityConfig = this.extractAntigravityConfig(rulesyncCommand);

    const trigger = this.resolveTrigger(rulesyncCommand, antigravityConfig);

    // Default to true unless explicitly set to false
    const turbo = typeof antigravityConfig?.turbo === "boolean" ? antigravityConfig.turbo : true;

    let relativeFilePath = rulesyncCommand.getRelativeFilePath();

    // Fix: Clean up body if it contains frontmatter (prevent double frontmatter)
    // This handles cases where body incorrectly includes the original frontmatter block
    let body = rulesyncCommand
      .getBody()
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
      .trim();

    // Transform into a Workflow
    // Note: resolveTrigger always returns a string (fallback to filename-based trigger)

    // 1. Rename file based on trigger (e.g. /my-workflow -> my-workflow.md)
    // Security: Sanitize trigger to prevent path traversal (e.g. /../evil)
    const sanitizedTrigger = trigger.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/^-+|-+$/g, "");
    if (!sanitizedTrigger) {
      throw new Error(`Invalid trigger: sanitization resulted in empty string from "${trigger}"`);
    }
    const validFilename = sanitizedTrigger + ".md";
    relativeFilePath = validFilename;

    // 2. Wrap content with Workflow header and turbo directive
    const turboDirective = turbo ? "\n\n// turbo" : "";

    // We don't need to duplicate the frontmatter in the body string for the file content
    // because stringifyFrontmatter will handle it.
    // But we DO need to update the body to include the specific workflow header.
    body = `# Workflow: ${trigger}\n\n${body}${turboDirective}`;

    const description = rulesyncFrontmatter.description;

    const antigravityFrontmatter: AntigravityCommandFrontmatter = {
      description,
      trigger,
      turbo,
    };

    // Generate proper file content with Antigravity specific frontmatter
    const fileContent = stringifyFrontmatter(body, antigravityFrontmatter);

    return new AntigravityCommand({
      baseDir: baseDir,
      frontmatter: antigravityFrontmatter,
      body,
      relativeDirPath: AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      fileContent: fileContent,
      validate,
    });
  }

  private static resolveTrigger(
    rulesyncCommand: RulesyncCommand,
    antigravityConfig: Record<string, unknown> | undefined,
  ): string {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Strategy 1: Look for explicit antigravity config in frontmatter (passed as parameter)
    const antigravityTrigger =
      antigravityConfig && typeof antigravityConfig.trigger === "string"
        ? antigravityConfig.trigger
        : undefined;

    // Strategy 2: Look for root level trigger (fallback)
    const rootTrigger =
      typeof rulesyncFrontmatter.trigger === "string" ? rulesyncFrontmatter.trigger : undefined;

    // Strategy 3: Look for trigger in body regex (Legacy support)
    // Support triggers with hyphens (e.g., /my-workflow)
    const bodyTriggerMatch = rulesyncCommand.getBody().match(/trigger:\s*(\/[\w-]+)/);

    // Strategy 4: Fallback to filename as trigger (e.g. add-tests.md -> /add-tests)
    const filenameTrigger = `/${basename(rulesyncCommand.getRelativeFilePath(), ".md")}`;

    return (
      antigravityTrigger ||
      rootTrigger ||
      (bodyTriggerMatch ? bodyTriggerMatch[1] : undefined) ||
      filenameTrigger
    );
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = AntigravityCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "antigravity",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<AntigravityCommand> {
    const filePath = join(
      baseDir,
      AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate frontmatter using AntigravityCommandFrontmatterSchema
    const result = AntigravityCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new AntigravityCommand({
      baseDir: baseDir,
      relativeDirPath: AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): AntigravityCommand {
    return new AntigravityCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
