import { join } from "node:path";

import { AGENTSMD_RULE_FILE_NAME } from "../../constants/agentsmd-paths.js";
import { POOL_GLOBAL_DIR } from "../../constants/pool-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleNestedFilePatterns,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";

export type PoolRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export type PoolRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

export class PoolRule extends ToolRule {
  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): PoolRuleSettablePaths | PoolRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: POOL_GLOBAL_DIR,
          relativeFilePath: AGENTSMD_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: AGENTSMD_RULE_FILE_NAME,
      },
    };
  }

  /**
   * Pool reads personal, project, and directory-level `AGENTS.md` files: inside
   * a git repository it loads every `AGENTS.md` from the repository root down
   * through the working directory (deeper files take precedence), skipping
   * ignored directories. Nested files are therefore a real scoping surface, not
   * just the root file's overflow.
   *
   * The scan mirrors the AGENTS.md standard's nested discovery — same file
   * name, same exclusions, import-only, project scope — because it discovers
   * literally the same files.
   * @see https://docs.poolside.ai/agent-instructions
   */
  static getNestedFilePatterns(): ToolRuleNestedFilePatterns {
    return this.buildNestedFilePatterns({ fileName: AGENTSMD_RULE_FILE_NAME });
  }

  /**
   * The subproject directory this rule scopes, or `undefined` for the root file
   * (project or global).
   */
  private getSubprojectPath(): string | undefined {
    return this.getNestedSubprojectPath({ fileName: AGENTSMD_RULE_FILE_NAME });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    relativeDirPath: overrideDirPath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<PoolRule> {
    const { root } = this.getSettablePaths({ global });

    // A nested per-directory file discovered by `getNestedFilePatterns` — the
    // processor passes its directory; the root file passes none (or the root
    // directory itself).
    if (
      overrideDirPath !== undefined &&
      overrideDirPath !== root.relativeDirPath &&
      overrideDirPath !== "."
    ) {
      const fileContent = await readFileContent(
        join(outputRoot, overrideDirPath, AGENTSMD_RULE_FILE_NAME),
      );
      return new PoolRule({
        outputRoot,
        relativeDirPath: overrideDirPath,
        relativeFilePath: AGENTSMD_RULE_FILE_NAME,
        fileContent,
        validate,
        root: false,
      });
    }

    const fileContent = await readFileContent(
      join(outputRoot, root.relativeDirPath, root.relativeFilePath),
    );

    return new PoolRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): PoolRule {
    const { root } = this.getSettablePaths({ global });
    const frontmatter = rulesyncRule.getFrontmatter();
    const isRoot = frontmatter.root ?? false;

    // A directory-scoped rule (the shared `agentsmd.subprojectPath` carrier)
    // becomes a nested `<dir>/AGENTS.md` instead of being folded into the root
    // file, because Pool loads it only while working under that directory.
    // Project scope only; the global root has no workspace to nest under.
    const subprojectPath = frontmatter.agentsmd?.subprojectPath;
    if (!global && !isRoot && subprojectPath) {
      return new PoolRule({
        outputRoot,
        relativeDirPath: join(subprojectPath),
        relativeFilePath: AGENTSMD_RULE_FILE_NAME,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: false,
      });
    }

    // Every other non-root rule folds into the root file: Pool has no modular
    // non-root instruction directory to map topic rules onto.
    return new PoolRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: isRoot,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const subprojectPath = this.getSubprojectPath();
    if (subprojectPath === undefined) {
      return this.toRulesyncRuleDefault();
    }

    // Pool's nested file *is* the AGENTS.md standard's own per-directory file,
    // at the same path several other targets read. Importing it through the
    // shared helper keeps one rulesync rule per subproject no matter which of
    // those targets discovered it first.
    return this.toRulesyncRuleNestedAgentsmd({ subprojectPath });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): PoolRule {
    const isRoot =
      relativeFilePath === AGENTSMD_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === POOL_GLOBAL_DIR);

    return new PoolRule({
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
      toolTarget: "pool",
    });
  }
}
