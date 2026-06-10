import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { assertSafeTaktName, prependTaktExtends } from "../takt-shared.js";
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
 * Default facet directory for TAKT rule files.
 *
 * Rulesync rules map to TAKT's `policies/` facet by default. The source
 * frontmatter may redirect a rule to another writable facet via `takt.facet`
 * (currently `policies` or `output-contracts`); see {@link TAKT_RULE_FACETS}.
 */
export const DEFAULT_TAKT_RULE_DIR = "policies";

/**
 * Writable Takt facets a rulesync rule may target via `takt.facet`.
 *
 * `policies` is the default. `output-contracts` lets users author Takt's
 * output-structure / report-template facet (which has no dedicated rulesync
 * feature) through the rules feature. Both are plain-Markdown facets that
 * support `{extends:...}` inheritance. Other facets (`personas`,
 * `instructions`, `knowledge`) are owned by the subagents, commands, and skills
 * features respectively and are intentionally not selectable here.
 */
export const TAKT_RULE_FACETS = ["policies", "output-contracts"] as const;

export type TaktRuleFacet = (typeof TAKT_RULE_FACETS)[number];

function resolveTaktRuleFacet(facet: unknown): TaktRuleFacet {
  return facet === "output-contracts" ? "output-contracts" : DEFAULT_TAKT_RULE_DIR;
}

export type TaktRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  body: string;
};

/**
 * Rule generator for TAKT (https://github.com/nrslib/takt).
 *
 * TAKT organizes prompts into faceted directories under `.takt/facets/`.
 * Rulesync rules map to TAKT's `policies/` facet by default; the source
 * frontmatter may rename the emitted stem via `takt.name` and redirect the rule
 * to another writable facet via `takt.facet` (`policies` or `output-contracts`).
 * `output-contracts` lets users author Takt's output-structure / report-template
 * facet — which has no dedicated rulesync feature — through the rules feature.
 *
 * The emitted files are plain Markdown — frontmatter is always dropped, and
 * the body is written verbatim. Like `takt.name` and `takt.extends`, the
 * `takt.facet` selection is a generate-side authoring control and is not
 * reconstructed on import (Takt facet files carry no frontmatter to recover it
 * from); importing `.takt/facets/policies/` yields plain rules.
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
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    relativeDirPath: overrideDirPath,
  }: ToolRuleFromFileParams): Promise<TaktRule> {
    const dirPath = overrideDirPath ?? join(".takt", "facets", DEFAULT_TAKT_RULE_DIR);
    const filePath = join(outputRoot, dirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    // Strip frontmatter when present (TAKT files are plain Markdown by spec, but
    // tolerate stray frontmatter on import for forward-compat).
    const { body } = parseFrontmatter(fileContent, filePath);

    return new TaktRule({
      outputRoot,
      relativeDirPath: dirPath,
      relativeFilePath,
      body: body.trim(),
      validate,
      root: false,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): TaktRule {
    return new TaktRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      validate: false,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
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

    const facet = resolveTaktRuleFacet(taktSection?.facet);
    const relativeDirPath = join(".takt", "facets", facet);

    const body = prependTaktExtends({
      extendsName: typeof taktSection?.extends === "string" ? taktSection.extends : undefined,
      body: rulesyncRule.getBody(),
      featureLabel: "rule",
      sourceLabel,
    });

    return new TaktRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body,
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
