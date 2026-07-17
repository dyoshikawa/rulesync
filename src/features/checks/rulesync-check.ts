import { basename, join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
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
// so unknown tool-specific keys survive a generate/import round-trip.
export const RulesyncCheckFrontmatterSchema = z.looseObject({
  targets: z._default(RulesyncTargetsSchema, ["*"]),
  description: z.optional(z.string()),
  // Kept generically named `severity` in the canonical source so a future tool
  // with its own severity naming can map onto it; maps to Amp's `severity-default`.
  // Bounded and well-documented, so a strict enum is appropriate here.
  // @see https://ampcode.com/manual
  severity: z.optional(z.enum(["low", "medium", "high", "critical"])),
  tools: z.optional(z.array(z.string())),
});

// Input type allows targets to be omitted (will use default value)
type RulesyncCheckFrontmatterInput = z.input<typeof RulesyncCheckFrontmatterSchema> &
  Partial<Record<ToolTarget, Record<string, unknown>>>;
// Output type has targets always present after parsing
export type RulesyncCheckFrontmatter = z.infer<typeof RulesyncCheckFrontmatterSchema> &
  Partial<Record<ToolTarget, Record<string, unknown>>>;

export type RulesyncCheckParams = Omit<RulesyncFileParams, "fileContent"> & {
  frontmatter: RulesyncCheckFrontmatterInput;
  body: string;
};

export type RulesyncCheckSettablePaths = {
  relativeDirPath: string;
};

export type RulesyncCheckFromFileParams = RulesyncFileFromFileParams;

export class RulesyncCheck extends RulesyncFile {
  private readonly frontmatter: RulesyncCheckFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncCheckParams) {
    // Parse frontmatter to apply defaults and validate
    const parseResult = RulesyncCheckFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate !== false) {
      throw new Error(
        `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`,
      );
    }
    // Apply defaults manually when validation is disabled but parsing failed.
    // Merge with frontmatter to preserve tool-specific sections (looseObject passthrough).
    const parsedFrontmatter: RulesyncCheckFrontmatter = parseResult.success
      ? { ...frontmatter, ...parseResult.data }
      : { ...frontmatter, targets: frontmatter?.targets ?? ["*"] };

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter),
    });

    this.frontmatter = parsedFrontmatter;
    this.body = body;
  }

  static getSettablePaths(): RulesyncCheckSettablePaths {
    return {
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
    };
  }

  getFrontmatter(): RulesyncCheckFrontmatter {
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

    const result = RulesyncCheckFrontmatterSchema.safeParse(this.frontmatter);

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
    outputRoot = process.cwd(),
    relativeFilePath,
  }: RulesyncCheckFromFileParams): Promise<RulesyncCheck> {
    // Read file content
    const filePath = join(outputRoot, RULESYNC_CHECKS_RELATIVE_DIR_PATH, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content, hasFrontmatter } = parseFrontmatter(fileContent, filePath);

    if (!hasFrontmatter) {
      throw new Error(
        `Missing frontmatter in ${filePath}. Rulesync files must begin with a YAML frontmatter block delimited by '---'.`,
      );
    }

    // Validate frontmatter using RulesyncCheckFrontmatterSchema
    const result = RulesyncCheckFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${relativeFilePath}: ${formatError(result.error)}`);
    }

    const filename = basename(relativeFilePath);

    return new RulesyncCheck({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
    });
  }
}
