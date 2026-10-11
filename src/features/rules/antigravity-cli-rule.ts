import { join } from "node:path";

import {
  ANTIGRAVITY_AGENTS_DIR,
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_GLOBAL_RULE_FILE_NAME,
  ANTIGRAVITY_GLOBAL_RULES_SUBDIR,
  ANTIGRAVITY_RULE_FILE_NAME,
} from "../../constants/antigravity-cli-paths.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  ANTIGRAVITY_NESTED_RULE_TARGETS,
  AntigravityRuleFrontmatter,
  AntigravityRuleFrontmatterSchema,
  STRATEGIES,
  extractAntigravitySubprojectPath,
  getAntigravityNestedFilePatterns,
  normalizeStoredAntigravity,
  parseGlobsString,
  resolveAntigravityNonRootFile,
  resolveAntigravitySubprojectPath,
  toAntigravityNestedRulesDirPath,
  toGlobalRuleFileName,
  toNestedRuleFileName,
} from "./antigravity-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleNestedFilePatterns,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type AntigravityCliRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export type AntigravityCliRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for the Google Antigravity CLI (`agy`, the Gemini-CLI
 * successor in Antigravity 2.0).
 *
 * The root context file is plain markdown; every non-root file under a
 * `rules/` directory must carry a valid `trigger` frontmatter or the CLI
 * silently discards it, so non-root rules get the same trigger-strategy
 * frontmatter as the IDE's non-root rules (which also keeps the two targets
 * writing identical files to the shared `.agents/rules/` tree).
 *
 * - Project scope: root `AGENTS.md` (the cross-tool standard, matching
 *   `antigravity-ide`); non-root `.agents/rules/*.md`.
 * - Global scope: root plain `~/.gemini/GEMINI.md` (shared with the IDE);
 *   non-root `~/.gemini/config/rules/*.md`. The CLI truncates each rule file at
 *   24,000 bytes, so keeping non-root rules as separate files stops a large rule
 *   set from being cut off.
 *
 * @see https://antigravity.google/docs/rules
 */
export class AntigravityCliRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): AntigravityCliRuleSettablePaths | AntigravityCliRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(ANTIGRAVITY_GEMINI_DIR, ".", excludeToolDir),
          relativeFilePath: ANTIGRAVITY_GLOBAL_RULE_FILE_NAME,
        },
        nonRoot: {
          relativeDirPath: buildToolPath(
            ANTIGRAVITY_GEMINI_DIR,
            ANTIGRAVITY_GLOBAL_RULES_SUBDIR,
            excludeToolDir,
          ),
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: ANTIGRAVITY_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(ANTIGRAVITY_AGENTS_DIR, "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<AntigravityCliRule> {
    const paths = this.getSettablePaths({ global });
    // A non-root file that happens to share the root file's name (e.g.
    // `~/.gemini/config/rules/GEMINI.md`) is not the root rule.
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      (relativeDirPath === undefined || relativeDirPath === paths.root.relativeDirPath);

    if (isRoot) {
      const relativePath = paths.root.relativeFilePath;
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, relativePath),
      );

      return new AntigravityCliRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
        global,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const nonRoot = resolveAntigravityNonRootFile({
      relativeDirPath,
      relativeFilePath,
      defaultDirPath: paths.nonRoot.relativeDirPath,
    });
    const relativePath = join(nonRoot.relativeDirPath, nonRoot.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));
    const rule = new AntigravityCliRule({
      outputRoot,
      relativeDirPath: nonRoot.relativeDirPath,
      relativeFilePath: nonRoot.relativeFilePath,
      fileContent,
      validate,
      root: false,
      global,
    });
    if (validate) {
      const result = rule.validate();
      if (!result.success) {
        throw new Error(`Invalid frontmatter in ${relativePath}: ${result.error.message}`);
      }
    }
    return rule;
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): AntigravityCliRule {
    const paths = this.getSettablePaths({ global });
    const params = this.buildToolRuleParamsDefault({
      outputRoot,
      rulesyncRule,
      validate,
      rootPath: paths.root,
      nonRootPath: paths.nonRoot,
    });
    if (params.root) {
      return new AntigravityCliRule({ ...params, global });
    }

    // Non-root rules live in a `rules/` directory, where a file without a
    // valid `trigger` is discarded, so derive it the same way the IDE does for
    // its non-root rules (a plain rule becomes `always_on`).
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const storedAntigravity = rulesyncFrontmatter.antigravity;
    const storedTrigger = storedAntigravity?.trigger;
    const strategy = STRATEGIES.find((s) => s.canHandle(storedTrigger));
    if (!strategy) {
      throw new Error(`No strategy found for trigger: ${storedTrigger}`);
    }
    const frontmatter = strategy.generateFrontmatter(
      normalizeStoredAntigravity(storedAntigravity),
      rulesyncFrontmatter,
    );

    const fileContent = stringifyFrontmatter(rulesyncRule.getBody(), frontmatter);
    if (!global) {
      // A subproject-scoped rule goes to that subproject's own `.agents/rules/`,
      // the same file the IDE writes for it.
      const subprojectPath = resolveAntigravitySubprojectPath({ rulesyncRule, global });
      return new AntigravityCliRule({
        ...params,
        ...(subprojectPath !== undefined && {
          relativeDirPath: toAntigravityNestedRulesDirPath(subprojectPath),
          relativeFilePath: toNestedRuleFileName(params.relativeFilePath),
        }),
        fileContent,
        global,
      });
    }

    return new AntigravityCliRule({
      ...params,
      relativeFilePath: toGlobalRuleFileName(params.relativeFilePath),
      fileContent,
      global,
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.root) {
      return this.toRulesyncRuleDefault();
    }

    const { frontmatter, body } = this.parseNonRootContent();
    const strategy = STRATEGIES.find((s) => s.canHandle(frontmatter.trigger));
    const rulesyncData = strategy
      ? strategy.exportRulesyncData(frontmatter)
      : { globs: [], antigravity: frontmatter };

    // A nested rule carries its directory back the same way the IDE's does.
    const subprojectPath = this.global
      ? undefined
      : extractAntigravitySubprojectPath(this.getRelativeDirPath())?.subprojectPath;

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: subprojectPath === undefined ? ["*"] : [...ANTIGRAVITY_NESTED_RULE_TARGETS],
        ...rulesyncData,
        antigravity: {
          ...rulesyncData.antigravity,
          globs: frontmatter.globs ? parseGlobsString(frontmatter.globs) : undefined,
        },
        ...(subprojectPath !== undefined && { agentsmd: { subprojectPath } }),
      },
      body,
    });
  }

  /**
   * The `.agents/rules/` folders of project subdirectories, imported back as
   * directory-scoped rules.
   * @see https://antigravity.google/docs/rules
   */
  static getNestedFilePatterns(): ToolRuleNestedFilePatterns {
    return getAntigravityNestedFilePatterns();
  }

  validate() {
    // Root rules (`AGENTS.md` / `GEMINI.md`) are plain markdown without
    // frontmatter requirements; non-root rules need Antigravity trigger
    // frontmatter.
    if (this.root) {
      return { success: true as const, error: null };
    }
    try {
      const { frontmatter } = this.parseNonRootContent();
      const result = AntigravityRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        return { success: false as const, error: new Error(formatError(result.error)) };
      }
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
    return { success: true as const, error: null };
  }

  /**
   * `~/.gemini/config/rules/` is shared with the Antigravity IDE and holds
   * global rules the user created outside rulesync, which cannot be told apart
   * from generated ones, so the orphan sweep never removes files there.
   */
  override isDeletable(): boolean {
    return !this.global || this.root;
  }

  private parseNonRootContent(): {
    frontmatter: AntigravityRuleFrontmatter;
    body: string;
  } {
    const { frontmatter, body } = parseFrontmatter(this.getFileContent(), this.getFilePath());
    return { frontmatter: frontmatter as AntigravityRuleFrontmatter, body };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): AntigravityCliRule {
    const paths = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      relativeDirPath === paths.root.relativeDirPath;

    return new AntigravityCliRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
      global,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "antigravity-cli",
    });
  }
}
