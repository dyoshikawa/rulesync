import { basename, join } from "node:path";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  AntigravityCommandFrontmatter,
  AntigravityCommandFrontmatterSchema,
} from "./antigravity-command.js";
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
 * Shared command (workflow) generator for Google Antigravity 2.0.
 *
 * Antigravity workflows share a single frontmatter shape
 * ({@link AntigravityCommandFrontmatter}) and an identical body transform: strip
 * any leading frontmatter, prepend a `# Workflow: <trigger>` header, and append
 * a `// turbo` directive unless turbo is disabled. The resolved trigger is
 * sanitized into the output filename to prevent path traversal.
 *
 * Concrete subclasses differ only in their workflows directory (project and
 * global scope) and the rulesync target name they answer to, supplied via
 * {@link AntigravitySharedCommand.getProjectRelativeDirPath},
 * {@link AntigravitySharedCommand.getGlobalRelativeDirPath},
 * {@link AntigravitySharedCommand.getToolTargetName} and a static
 * `isTargetedByRulesyncCommand` override.
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

  private static extractAntigravityConfig(
    rulesyncCommand: RulesyncCommand,
  ): Record<string, unknown> | undefined {
    const antigravity = rulesyncCommand.getFrontmatter().antigravity;
    return isRecord(antigravity) ? antigravity : undefined;
  }

  private static resolveTrigger(
    rulesyncCommand: RulesyncCommand,
    antigravityConfig: Record<string, unknown> | undefined,
  ): string {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const antigravityTrigger =
      antigravityConfig && typeof antigravityConfig.trigger === "string"
        ? antigravityConfig.trigger
        : undefined;

    const rootTrigger =
      typeof rulesyncFrontmatter.trigger === "string" ? rulesyncFrontmatter.trigger : undefined;

    const bodyTriggerMatch = rulesyncCommand.getBody().match(/trigger:\s*(\/[\w-]+)/);

    const filenameTrigger = `/${basename(rulesyncCommand.getRelativeFilePath(), ".md")}`;

    return (
      antigravityTrigger ||
      rootTrigger ||
      (bodyTriggerMatch ? bodyTriggerMatch[1] : undefined) ||
      filenameTrigger
    );
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): AntigravitySharedCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const antigravityConfig = this.extractAntigravityConfig(rulesyncCommand);

    const trigger = this.resolveTrigger(rulesyncCommand, antigravityConfig);

    const turbo = typeof antigravityConfig?.turbo === "boolean" ? antigravityConfig.turbo : true;

    let body = rulesyncCommand
      .getBody()
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
      .trim();

    // Sanitize trigger to prevent path traversal (e.g. /../evil).
    const sanitizedTrigger = trigger.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/^-+|-+$/g, "");
    if (!sanitizedTrigger) {
      throw new Error(`Invalid trigger: sanitization resulted in empty string from "${trigger}"`);
    }
    const relativeFilePath = `${sanitizedTrigger}.md`;

    const turboDirective = turbo ? "\n\n// turbo" : "";
    body = `# Workflow: ${trigger}\n\n${body}${turboDirective}`;

    const description = rulesyncFrontmatter.description;

    const antigravityFrontmatter: AntigravityCommandFrontmatter = {
      description,
      trigger,
      turbo,
    };

    const fileContent = stringifyFrontmatter(body, antigravityFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new this({
      outputRoot,
      frontmatter: antigravityFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent,
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
