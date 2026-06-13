import { join } from "node:path";

import {
  JUNIE_DIR,
  JUNIE_LEGACY_RULE_FILE_NAME,
  JUNIE_RULE_FILE_NAME,
} from "../../constants/junie-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type JunieRuleParams = AiFileParams;

export type JunieRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for JetBrains Junie AI coding agent
 *
 * Generates `.junie/AGENTS.md` files based on rulesync rule content. `.junie/AGENTS.md`
 * is the preferred guideline file in current Junie; the legacy `.junie/guidelines.md`
 * is still read by Junie and is accepted as an import fallback, but generation always
 * targets `.junie/AGENTS.md`. Junie uses plain markdown without frontmatter requirements.
 *
 * Global (user) scope writes a single `~/.junie/AGENTS.md` file. Junie merges these
 * user-scope guidelines with the project `.junie/AGENTS.md` (project takes priority on
 * conflicts); memory files (`.junie/memories/`) remain project-scoped only.
 *
 * @see https://junie.jetbrains.com/docs/junie-ide-plugin.html
 * @see https://junie.jetbrains.com/docs/guidelines-and-memory.html
 */
export class JunieRule extends ToolRule {
  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): JunieRuleSettablePaths | ToolRuleSettablePathsGlobal {
    if (global) {
      // Junie merges the user-scope `~/.junie/AGENTS.md` guideline file with the
      // project `.junie/AGENTS.md`. Global guidelines are a single root file; memory
      // files (`.junie/memories/`) stay project-scoped.
      return {
        root: {
          relativeDirPath: buildToolPath(JUNIE_DIR, ".", excludeToolDir),
          relativeFilePath: JUNIE_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: buildToolPath(JUNIE_DIR, ".", excludeToolDir),
        relativeFilePath: JUNIE_RULE_FILE_NAME,
      },
      // Junie still reads the legacy `.junie/guidelines.md`; accept it on import as a
      // fallback when `.junie/AGENTS.md` is absent so existing repos keep round-tripping.
      alternativeRoots: [
        {
          relativeDirPath: buildToolPath(JUNIE_DIR, ".", excludeToolDir),
          relativeFilePath: JUNIE_LEGACY_RULE_FILE_NAME,
        },
      ],
      nonRoot: {
        relativeDirPath: buildToolPath(JUNIE_DIR, "memories", excludeToolDir),
      },
    };
  }

  /**
   * Determines whether a given relative file path refers to a root guideline file.
   * The preferred file is `AGENTS.md`; the legacy `guidelines.md` is still accepted.
   * Memory files live under `.junie/memories/` and are passed in as bare filenames
   * (e.g. `memo.md`), so a top-level `AGENTS.md`/`guidelines.md` is the root entry.
   */
  private static isRootRelativeFilePath(relativeFilePath: string): boolean {
    return relativeFilePath === JUNIE_RULE_FILE_NAME || relativeFilePath === JUNIE_LEGACY_RULE_FILE_NAME;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<JunieRule> {
    if (global) {
      const paths = this.getSettablePaths({ global: true });
      if (!("root" in paths) || !paths.root) {
        throw new Error("JunieRule global settable paths must include a root path");
      }
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );

      return new JunieRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    const isRoot = JunieRule.isRootRelativeFilePath(relativeFilePath);
    const settablePaths = this.getSettablePaths();
    if (!settablePaths.nonRoot) {
      throw new Error("JunieRule project settable paths must include a nonRoot path");
    }
    const relativeDirPath = isRoot
      ? settablePaths.root.relativeDirPath
      : settablePaths.nonRoot.relativeDirPath;
    // Read from the actual discovered filename so the legacy `guidelines.md` fallback
    // is loaded correctly; generation still normalizes back to `AGENTS.md`.
    const relativePath = join(relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new JunieRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): JunieRule {
    if (global) {
      const paths = this.getSettablePaths({ global: true });
      if (!("root" in paths) || !paths.root) {
        throw new Error("JunieRule global settable paths must include a root path");
      }
      if (!rulesyncRule.getFrontmatter().root) {
        throw new Error(
          `JunieRule does not support non-root rules in global mode; expected a root rule but got '${rulesyncRule.getRelativeFilePath()}'`,
        );
      }
      return new JunieRule(
        this.buildToolRuleParamsDefault({
          outputRoot,
          rulesyncRule,
          validate,
          rootPath: paths.root,
        }),
      );
    }

    return new JunieRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // Junie rules are always valid since they don't require frontmatter
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): JunieRule {
    const isRoot = JunieRule.isRootRelativeFilePath(relativeFilePath);

    return new JunieRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "junie",
    });
  }
}
