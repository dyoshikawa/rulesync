import { basename, join } from "node:path";

import { z } from "zod/mini";

import { GOOSE_CHECKS_GLOBAL_DIR, GOOSE_CHECKS_PROJECT_DIR } from "../../constants/goose-paths.js";
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
// so unknown Goose-specific keys survive a generate/import round-trip. Goose's
// `CheckFrontmatter` is Amp's field set plus `model` and `turn-limit`.
// @see https://github.com/aaif-goose/goose/blob/main/crates/goose/src/checks/mod.rs
export const GooseCheckFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  "severity-default": z.optional(z.enum(["low", "medium", "high", "critical"])),
  tools: z.optional(z.array(z.string())),
  model: z.optional(z.string()),
  "turn-limit": z.optional(z.number()),
});

export type GooseCheckFrontmatter = z.infer<typeof GooseCheckFrontmatterSchema>;

export type GooseCheckParams = {
  frontmatter: GooseCheckFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & {
    // When omitted, the raw file content is derived from `frontmatter` + `body`.
    fileContent?: string;
  };

/**
 * Represents a Goose review check (`goose review`), written to the user-wide
 * `~/.config/goose/checks/` (global scope only).
 *
 * Goose discovers repository checks in `.agents/checks/*.md`, the same
 * cross-tool directory the `amp` checks target already writes (Goose's
 * `tools` and `severity-default` fields exist for parity with Amp's), so the
 * project scope is left to `amp` rather than having two targets own the same
 * files. Its global discovery reads `~/.config/goose/checks/` first, then
 * `~/.config/agents/checks/`. The frontmatter is Amp's plus `model` and
 * `turn-limit`; `name` is derived from the file name.
 *
 * @see https://github.com/aaif-goose/goose/blob/main/crates/goose/src/checks/mod.rs
 */
export class GooseCheck extends ToolCheck {
  private readonly frontmatter: GooseCheckFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: GooseCheckParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = GooseCheckFrontmatterSchema.safeParse(frontmatter);
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
      relativeDirPath: global ? GOOSE_CHECKS_GLOBAL_DIR : GOOSE_CHECKS_PROJECT_DIR,
    };
  }

  getFrontmatter(): GooseCheckFrontmatter {
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
  }: ToolCheckFromRulesyncCheckParams): GooseCheck {
    const rulesyncFrontmatter = rulesyncCheck.getFrontmatter();
    const relativeFilePath = rulesyncCheck.getRelativeFilePath();

    // Goose identifies a check by `name`; derive it from the source file basename.
    const name = basename(relativeFilePath, ".md");

    // Drop the standard targeting field and map `severity` to Goose's
    // `severity-default`; everything else (including unknown keys) passes through.
    const { targets: _targets, description, severity, tools, ...restFields } = rulesyncFrontmatter;

    // Tool-target sections (e.g. `goose:`) are per-tool overrides, not check
    // content: exclude them all from the passthrough, then merge this tool's
    // own section last so a tool-specific value takes precedence over the
    // canonical one. `name` is excluded from the override because the check
    // identity is carried by the file basename.
    const toolTargetKeys = new Set<string>(ALL_TOOL_TARGETS);
    const passthroughFields = Object.fromEntries(
      Object.entries(restFields).filter(([key]) => !toolTargetKeys.has(key) && key !== "name"),
    );
    const gooseSection = this.filterToolSpecificSection(rulesyncFrontmatter.goose ?? {}, ["name"]);

    const rawGooseFrontmatter = {
      name,
      ...(description !== undefined && { description }),
      ...(severity !== undefined && { "severity-default": severity }),
      ...(tools !== undefined && { tools }),
      ...passthroughFields,
      ...gooseSection,
    };

    const result = GooseCheckFrontmatterSchema.safeParse(rawGooseFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid goose check frontmatter in ${relativeFilePath}: ${formatError(result.error)}`,
      );
    }

    const gooseFrontmatter = result.data;
    const body = rulesyncCheck.getBody();
    const fileContent = stringifyFrontmatter(body, gooseFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new GooseCheck({
      outputRoot,
      frontmatter: gooseFrontmatter,
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

    const result = GooseCheckFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "goose",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCheckFromFileParams): Promise<GooseCheck> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = GooseCheckFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new GooseCheck({
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
  }: ToolCheckForDeletionParams): GooseCheck {
    return new GooseCheck({
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
