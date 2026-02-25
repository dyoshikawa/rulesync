import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const ClaudecodeSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  model: z.optional(z.string()),
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  permissionMode: z.optional(z.string()),
  skills: z.optional(z.union([z.string(), z.array(z.string())])),
});

export type ClaudecodeSubagentFrontmatter = z.infer<typeof ClaudecodeSubagentFrontmatterSchema>;

export type ClaudecodeSubagentParams = {
  frontmatter: ClaudecodeSubagentFrontmatter;
  body: string;
} & AiFileParams;

export class ClaudecodeSubagent extends ToolSubagent {
  private readonly frontmatter: ClaudecodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ClaudecodeSubagentParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = ClaudecodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".claude", "agents"),
    };
  }

  getFrontmatter(): ClaudecodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, model, ...restFields } = this.frontmatter;

    // Build claudecode section with known and unknown fields
    const claudecodeSection: Record<string, unknown> = {
      ...(model && { model }),
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      // Only include claudecode section if there are fields
      ...(Object.keys(claudecodeSection).length > 0 && { claudecode: claudecodeSection }),
    };

    return new RulesyncSubagent({
      baseDir: ".", // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const claudecodeSection = rulesyncFrontmatter.claudecode ?? {};

    // Build claudecode frontmatter from rulesync frontmatter + claudecode section
    const rawClaudecodeFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...claudecodeSection,
    };

    // Validate with ClaudecodeSubagentFrontmatterSchema (validates model if present)
    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(rawClaudecodeFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid claudecode subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const claudecodeFrontmatter = result.data;

    // Generate proper file content with Claude Code specific frontmatter
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, claudecodeFrontmatter);

    const paths = this.getSettablePaths({ global });

    return new ClaudecodeSubagent({
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
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

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "claudecode",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<ClaudecodeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate frontmatter using ClaudecodeSubagentFrontmatterSchema
    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ClaudecodeSubagent({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: relativeFilePath,
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
  }: ToolSubagentForDeletionParams): ClaudecodeSubagent {
    return new ClaudecodeSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
