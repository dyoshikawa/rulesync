import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { assertSafeTaktName } from "../takt-shared.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

/**
 * Fixed facet directory for TAKT rule files.
 *
 * Rulesync rules map one-to-one to TAKT's `policies/` facet. No override
 * is supported; the directory is always `.takt/facets/policies/`.
 */
export const DEFAULT_TAKT_RULE_DIR = "policies";

export type TaktRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  body: string;
};

/**
 * Rule generator for TAKT (https://github.com/dyoshikawa/takt).
 *
 * TAKT organizes prompts into faceted directories under `.takt/facets/`.
 * Rulesync rules always map to TAKT's `policies/` facet; the source
 * frontmatter may rename the emitted stem via `takt.name`, but the facet
 * directory is fixed.
 *
 * The emitted files are plain Markdown — frontmatter is always dropped, and
 * the body is written verbatim.
 */
export class TaktRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ToolRuleSettablePaths | ToolRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(
            ".takt",
            join("facets", DEFAULT_TAKT_RULE_DIR),
            excludeToolDir,
          ),
          relativeFilePath: "overview.md",
        },
      };
    }
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(
          ".takt",
          join("facets", DEFAULT_TAKT_RULE_DIR),
          excludeToolDir,
        ),
      },
    };
  }

  constructor({ body, ...rest }: TaktRuleParams) {
    super({
      ...rest,
      fileContent: body,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    relativeDirPath: overrideDirPath,
  }: ToolRuleFromFileParams): Promise<TaktRule> {
    const dirPath = overrideDirPath ?? join(".takt", "facets", DEFAULT_TAKT_RULE_DIR);
    const filePath = join(baseDir, dirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    // Strip frontmatter when present (TAKT files are plain Markdown by spec, but
    // tolerate stray frontmatter on import for forward-compat).
    const { body } = parseFrontmatter(fileContent, filePath);

    return new TaktRule({
      baseDir,
      relativeDirPath: dirPath,
      relativeFilePath,
      body: body.trim(),
      validate,
      root: false,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): TaktRule {
    return new TaktRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      body: "",
      validate: false,
      root: false,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): TaktRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const taktSection = rulesyncFrontmatter.takt;
    const sourceLabel = rulesyncRule.getRelativeFilePath();

    const overrideName = typeof taktSection?.name === "string" ? taktSection.name : undefined;
    const sourceStem = rulesyncRule.getRelativeFilePath().replace(/\.md$/u, "");
    const stem = overrideName ?? sourceStem;
    assertSafeTaktName({ name: stem, featureLabel: "rule", sourceLabel });
    const relativeFilePath = `${stem}.md`;

    const relativeDirPath = join(".takt", "facets", DEFAULT_TAKT_RULE_DIR);

    return new TaktRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "takt",
    });
  }
}
