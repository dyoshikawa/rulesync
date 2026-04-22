import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { assertSafeTaktName, resolveTaktFacetDir } from "../takt-shared.js";
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
 * Allowed `facet` values for TAKT rule files.
 *
 * - `policy`: hard rules and constraints (default)
 * - `knowledge`: factual context (architecture, glossaries, references)
 * - `output-contract`: output formatting / contract specifications
 */
export const TAKT_RULE_FACET_VALUES = ["policy", "knowledge", "output-contract"] as const;
export type TaktRuleFacet = (typeof TAKT_RULE_FACET_VALUES)[number];

const TAKT_RULE_FACET_TO_DIR: Record<TaktRuleFacet, string> = {
  policy: "policies",
  knowledge: "knowledge",
  "output-contract": "output-contracts",
};

const DEFAULT_TAKT_RULE_FACET: TaktRuleFacet = "policy";

/** Default facet directory used when `takt.facet` is not provided. */
export const DEFAULT_TAKT_RULE_DIR = TAKT_RULE_FACET_TO_DIR[DEFAULT_TAKT_RULE_FACET];

export type TaktRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  body: string;
};

/**
 * Resolve the TAKT facet directory for a rules-feature file.
 *
 * @throws when an explicit `takt.facet` value is not allowed for the rules feature
 */
export function resolveTaktRuleFacetDir(facetValue: unknown, sourceLabel: string): string {
  return resolveTaktFacetDir({
    value: facetValue,
    allowed: TAKT_RULE_FACET_VALUES,
    defaultDir: DEFAULT_TAKT_RULE_DIR,
    dirMap: TAKT_RULE_FACET_TO_DIR,
    featureLabel: "rule",
    sourceLabel,
  });
}

/**
 * Rule generator for TAKT (https://github.com/dyoshikawa/takt).
 *
 * TAKT organizes prompts into faceted directories under `.takt/facets/`.
 * Rulesync rules map to TAKT *policy* facets by default; the source frontmatter
 * may override the facet via `takt.facet` (`policy`, `knowledge`, or
 * `output-contract`) and may rename the emitted stem via `takt.name`.
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

    const facetDir = resolveTaktRuleFacetDir(taktSection?.facet, sourceLabel);

    const overrideName = typeof taktSection?.name === "string" ? taktSection.name : undefined;
    const sourceStem = rulesyncRule.getRelativeFilePath().replace(/\.md$/u, "");
    const stem = overrideName ?? sourceStem;
    assertSafeTaktName({ name: stem, featureLabel: "rule", sourceLabel });
    const relativeFilePath = `${stem}.md`;

    const relativeDirPath = join(".takt", "facets", facetDir);

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
