import { basename, join } from "node:path";

import { z } from "zod/mini";

import { AMP_CHECKS_GLOBAL_DIR, AMP_CHECKS_PROJECT_DIR } from "../../constants/amp-paths.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ALL_TOOL_TARGETS } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCheck, RulesyncCheckFrontmatter } from "./rulesync-check.js";
import {
  ToolCheck,
  ToolCheckForDeletionParams,
  ToolCheckFromFileParams,
  ToolCheckFromRulesyncCheckParams,
  ToolCheckSettablePaths,
} from "./tool-check.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
// so unknown Amp-specific keys survive a generate/import round-trip.
// `severity-default` is bounded and documented, so a strict enum is appropriate.
// @see https://ampcode.com/manual
export const AmpCheckFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  "severity-default": z.optional(z.enum(["low", "medium", "high", "critical"])),
  tools: z.optional(z.array(z.string())),
});

export type AmpCheckFrontmatter = z.infer<typeof AmpCheckFrontmatterSchema>;

export type AmpCheckParams = {
  frontmatter: AmpCheckFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & {
    // When omitted, the raw file content is derived from `frontmatter` + `body`.
    fileContent?: string;
  };

/**
 * Represents an Amp code review check.
 *
 * Amp natively reads code review checks as Markdown files with YAML frontmatter,
 * scoped to the project (`.agents/checks/`) and user-wide (`~/.config/amp/checks/`).
 * Each check runs as a per-check subagent during code review.
 * @see https://ampcode.com/manual
 */
export class AmpCheck extends ToolCheck {
  private readonly frontmatter: AmpCheckFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: AmpCheckParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = AmpCheckFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: fileContent ?? stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCheckSettablePaths {
    return {
      relativeDirPath: global ? AMP_CHECKS_GLOBAL_DIR : AMP_CHECKS_PROJECT_DIR,
    };
  }

  getFrontmatter(): AmpCheckFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncCheck(): RulesyncCheck {
    // The `name` field is re-derived from the file basename on generate, so it is
    // intentionally dropped here (the file basename carries the check identity).
    const {
      name: _name,
      description,
      "severity-default": severityDefault,
      tools,
      ...restFields
    } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCheckFrontmatter = {
      targets: ["*"] as const,
      ...(description !== undefined && { description }),
      ...(severityDefault !== undefined && { severity: severityDefault }),
      ...(tools !== undefined && { tools }),
      ...restFields,
    };

    return new RulesyncCheck({
      outputRoot: ".", // RulesyncCheck outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncCheck({
    outputRoot = process.cwd(),
    rulesyncCheck,
    validate = true,
    global = false,
  }: ToolCheckFromRulesyncCheckParams): AmpCheck {
    const rulesyncFrontmatter = rulesyncCheck.getFrontmatter();
    const relativeFilePath = rulesyncCheck.getRelativeFilePath();

    // Amp requires `name`; derive it from the source file basename.
    const name = basename(relativeFilePath, ".md");

    // Drop the standard targeting field and map `severity` to Amp's
    // `severity-default`; everything else (including unknown keys) passes through.
    const { targets: _targets, description, severity, tools, ...restFields } = rulesyncFrontmatter;

    // Tool-target sections (e.g. `amp:`) are per-tool overrides, not check
    // content: exclude them all from the passthrough, then merge this tool's
    // own section last so a tool-specific value takes precedence over the
    // canonical one. `name` is excluded from the override because the check
    // identity is carried by the file basename.
    const toolTargetKeys = new Set<string>(ALL_TOOL_TARGETS);
    const passthroughFields = Object.fromEntries(
      Object.entries(restFields).filter(([key]) => !toolTargetKeys.has(key) && key !== "name"),
    );
    const ampSection = this.filterToolSpecificSection(rulesyncFrontmatter.amp ?? {}, ["name"]);

    const rawAmpFrontmatter = {
      name,
      ...(description !== undefined && { description }),
      ...(severity !== undefined && { "severity-default": severity }),
      ...(tools !== undefined && { tools }),
      ...passthroughFields,
      ...ampSection,
    };

    const result = AmpCheckFrontmatterSchema.safeParse(rawAmpFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid amp check frontmatter in ${relativeFilePath}: ${formatError(result.error)}`,
      );
    }

    const ampFrontmatter = result.data;
    const body = rulesyncCheck.getBody();
    const fileContent = stringifyFrontmatter(body, ampFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new AmpCheck({
      outputRoot,
      frontmatter: ampFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = AmpCheckFrontmatterSchema.safeParse(this.frontmatter);
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

  static isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({
      rulesyncCheck,
      toolTarget: "amp",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCheckFromFileParams): Promise<AmpCheck> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = AmpCheckFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new AmpCheck({
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
  }: ToolCheckForDeletionParams): AmpCheck {
    return new AmpCheck({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
