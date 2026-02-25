import { basename, join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema, ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
// Tool-specific sections (e.g., claudecode:) are preserved as additional keys
export const RulesyncSubagentFrontmatterSchema = z.looseObject({
  targets: z._default(RulesyncTargetsSchema, ["*"]),
  name: z.string(),
  description: z.string(),
});

// Input type allows targets to be omitted (will use default value)
export type RulesyncSubagentFrontmatterInput = z.input<typeof RulesyncSubagentFrontmatterSchema> &
  Partial<Record<ToolTarget, Record<string, unknown>>>;
// Output type has targets always present after parsing
export type RulesyncSubagentFrontmatter = z.infer<typeof RulesyncSubagentFrontmatterSchema> &
  Partial<Record<ToolTarget, Record<string, unknown>>>;

export type RulesyncSubagentParams = Omit<RulesyncFileParams, "fileContent"> & {
  frontmatter: RulesyncSubagentFrontmatterInput;
  body: string;
};

export type RulesyncSubagentSettablePaths = {
  relativeDirPath: string;
};

export type RulesyncSubagentFromFileParams = RulesyncFileFromFileParams;

export class RulesyncSubagent extends RulesyncFile {
  private readonly frontmatter: RulesyncSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncSubagentParams) {
    // Parse frontmatter to apply defaults and validate
    const parseResult = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate !== false) {
      throw new Error(
        `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`,
      );
    }
    // Apply defaults manually when validation is disabled but parsing failed
    // Merge with frontmatter to preserve tool-specific sections (looseObject passthrough)
    const parsedFrontmatter: RulesyncSubagentFrontmatter = parseResult.success
      ? { ...frontmatter, ...parseResult.data }
      : { ...frontmatter, targets: frontmatter?.targets ?? ["*"] };

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter),
    });

    this.frontmatter = parsedFrontmatter;
    this.body = body;
  }

  static getSettablePaths(): RulesyncSubagentSettablePaths {
    return {
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    };
  }

  getFrontmatter(): RulesyncSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncSubagentFrontmatterSchema.safeParse(this.frontmatter);

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

  static async fromFile({
    relativeFilePath,
  }: RulesyncSubagentFromFileParams): Promise<RulesyncSubagent> {
    // Read file content
    const filePath = join(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate frontmatter using SubagentFrontmatterSchema
    const result = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${relativeFilePath}: ${formatError(result.error)}`);
    }

    const filename = basename(relativeFilePath);

    return new RulesyncSubagent({
      baseDir: process.cwd(),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
    });
  }
}
