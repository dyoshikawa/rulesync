import { dirname, join } from "node:path";

import { ROO_DIR, ROO_MODE_SLUG_PATTERN, rooModeRulesDirName } from "../../constants/roo-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleNestedFilePatterns,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type RooRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for Roo Code AI assistant
 *
 * Generates rule files for Roo Code's hierarchical rule system.
 * Supports plain Markdown without frontmatter, mode-specific rules,
 * and both directory-based and single-file configurations.
 *
 * - Project scope writes the non-root directory `.roo/rules/`.
 * - Global scope writes the same non-root directory resolved under the home
 *   directory (`~/.roo/rules/`), which Roo loads before workspace rules.
 *   @see https://roocodeinc.github.io/Roo-Code/features/custom-instructions
 */
export class RooRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): RooRuleSettablePaths {
    // The relative directory is identical for project and global scope; global
    // mode differs only by output root (the home directory), so `~/.roo/rules/`
    // is produced without a separate branch here.
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(ROO_DIR, "rules", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    relativeDirPath: overrideDirPath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<RooRule> {
    // A file discovered under `.roo/rules-{mode}/` by `getNestedFilePatterns`:
    // the processor passes its directory, which is not the generic rules
    // directory this class otherwise reads.
    const relativeDirPath =
      overrideDirPath !== undefined && RooRule.extractModeFromDirPath(overrideDirPath) !== undefined
        ? overrideDirPath
        : this.getSettablePaths().nonRoot.relativeDirPath;

    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new RooRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): RooRule {
    const params = this.buildToolRuleParamsDefault({
      outputRoot,
      rulesyncRule,
      validate,
      nonRootPath: this.getSettablePaths().nonRoot,
    });

    // A non-root rule scoped to one mode goes to `.roo/rules-{mode}/`, which
    // Roo/Zoo Code load INSTEAD of `.roo/rules/` while that mode is active. The
    // root rule has no mode-specific counterpart, so the key is ignored there.
    const mode = rulesyncRule.getFrontmatter().roo?.mode;
    if (!params.root && mode !== undefined && mode !== "") {
      if (!ROO_MODE_SLUG_PATTERN.test(mode)) {
        // Fail safe rather than interpolating an arbitrary string into a
        // directory name: a slug with a separator or a `..` segment would write
        // outside `.roo/`, and one the tool cannot produce would never be read.
        warnWithFallback(
          undefined,
          `Ignoring roo.mode "${mode}" on ${rulesyncRule.getRelativeFilePath()}: a mode slug may contain only letters, digits and hyphens. Writing the rule to ${params.relativeDirPath} instead.`,
        );
      } else {
        // Derived from the generic directory rather than rebuilt from
        // constants, so it follows whatever `getSettablePaths` resolved
        // (`.roo/rules` → `.roo/rules-{mode}`).
        params.relativeDirPath = join(dirname(params.relativeDirPath), rooModeRulesDirName(mode));
      }
    }

    return new RooRule(params);
  }

  /**
   * Extract mode slug from file path for mode-specific rules
   * Returns undefined for non-mode-specific rules
   */
  static extractModeFromPath(filePath: string): string | undefined {
    // Check for mode-specific patterns:
    // .roo/rules-{mode}/ or .roorules-{mode} or .clinerules-{mode}

    // Directory pattern: .roo/rules-{mode}/
    const directoryMatch = filePath.match(/\.roo\/rules-([a-zA-Z0-9-]+)\//);
    if (directoryMatch) {
      return directoryMatch[1];
    }

    // Single-file patterns: .roorules-{mode} or .clinerules-{mode}
    const singleFileMatch = filePath.match(/\.(roo|cline)rules-([a-zA-Z0-9-]+)$/);
    if (singleFileMatch) {
      return singleFileMatch[2];
    }

    return undefined;
  }

  /**
   * The mode slug of a `.roo/rules-{mode}/` directory, or `undefined` for the
   * generic `.roo/rules/` directory and anything else. Path-shaped input is
   * rejected by the slug pattern, so a crafted directory name cannot be lifted
   * back into frontmatter.
   */
  static extractModeFromDirPath(relativeDirPath: string): string | undefined {
    // Any segment, not just the last: Roo also reads subfolders of a mode
    // directory, so an imported file can sit at `.roo/rules-code/sub/`.
    for (const segment of toPosixPath(relativeDirPath).split("/")) {
      if (!segment.startsWith("rules-")) {
        continue;
      }
      const mode = segment.slice("rules-".length);
      if (ROO_MODE_SLUG_PATTERN.test(mode)) {
        return mode;
      }
    }
    return undefined;
  }

  toRulesyncRule(): RulesyncRule {
    const mode = RooRule.extractModeFromDirPath(this.getRelativeDirPath());
    if (mode === undefined) {
      return this.toRulesyncRuleDefault();
    }

    // Mode-scoped rules import under a mode-suffixed name: `.roo/rules/x.md`
    // and `.roo/rules-code/x.md` are different rules that would otherwise
    // collide on one `.rulesync/rules/x.md`.
    const baseName = this.getRelativeFilePath().replace(/\.md$/, "");
    return new RulesyncRule({
      outputRoot: this.getOutputRoot(),
      relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: `${baseName}-${mode}.md`,
      frontmatter: {
        root: false,
        targets: ["*"],
        description: this.description,
        globs: this.globs ?? [],
        roo: { mode },
      },
      body: this.getFileContent(),
      validate: true,
    });
  }

  /**
   * Mode-specific rule directories (`.roo/rules-{mode}/`), which Roo/Zoo Code
   * load instead of `.roo/rules/` while that mode is active. Import-only: the
   * generic directory is the only one the deletion sweep enumerates, because a
   * `rules-*` glob would also match mode rules a user wrote by hand.
   */
  static getNestedFilePatterns({ outputRoot }: { outputRoot: string }): ToolRuleNestedFilePatterns {
    const root = toPosixPath(outputRoot);
    return {
      include: [`${root}/${toPosixPath(ROO_DIR)}/rules-*/**/*.md`],
      ignore: [],
    };
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): RooRule {
    return new RooRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "roo",
    });
  }

  /**
   * Glob for the `separate-local-file` deletion; Roo reads `AGENTS.local.md`
   * at the project root, not under `.roo/` (mirrors rovodev).
   */
  static getLocalRootFileGlob({
    outputRoot,
    fileName,
  }: {
    outputRoot: string;
    fileName: string;
  }): string {
    return join(outputRoot, fileName);
  }
}
