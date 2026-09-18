import { join } from "node:path";

import { AGENTSMD_RULE_FILE_NAME } from "../../constants/agentsmd-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
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

export type NestedAgentsmdRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export type NestedAgentsmdRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * What distinguishes one AGENTS.md-family target from another: everything else
 * about the family is shared behavior in {@link NestedAgentsmdRule}.
 */
export type NestedAgentsmdRuleFamily = {
  /** Directory of the personal root `AGENTS.md`, relative to the home directory. */
  globalDir: string;
  /** The `targets` entry that selects this tool in a rulesync rule's frontmatter. */
  toolTarget: ToolTarget;
};

/**
 * Shared adapter for the targets that read instructions exactly the way the
 * AGENTS.md standard describes them and nothing more: a root `AGENTS.md` at the
 * project root, nested per-directory `AGENTS.md` files loaded only while working
 * under that directory, and a single personal root file under a tool-specific
 * home directory. Such a target has no modular non-root instruction directory,
 * so every other non-root rule folds into the root file.
 *
 * Concrete targets (Pool, Vibe, DeepSeek Harness) only supply the global
 * directory and their tool target through {@link getFamily}; the vendor docs
 * describing each one's discovery walk live on the subclass.
 *
 * The nested-file scan mirrors the AGENTS.md standard's nested discovery —
 * same file name, same exclusions, import-only, project scope — because it
 * discovers literally the same files.
 */
export class NestedAgentsmdRule extends ToolRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    throw new Error("Please implement this method in the subclass.");
  }

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): NestedAgentsmdRuleSettablePaths | NestedAgentsmdRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: this.getFamily().globalDir,
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
  }: ToolRuleFromFileParams): Promise<NestedAgentsmdRule> {
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
      return new this({
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

    return new this({
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
  }: ToolRuleFromRulesyncRuleParams): NestedAgentsmdRule {
    const { root } = this.getSettablePaths({ global });
    const frontmatter = rulesyncRule.getFrontmatter();
    const isRoot = frontmatter.root ?? false;

    // A directory-scoped rule (the shared `agentsmd.subprojectPath` carrier)
    // becomes a nested `<dir>/AGENTS.md` instead of being folded into the root
    // file, because the tool loads it only while working under that directory.
    // Project scope only; the global root has no workspace to nest under.
    const subprojectPath = frontmatter.agentsmd?.subprojectPath;
    if (!global && !isRoot && subprojectPath) {
      return new this({
        outputRoot,
        relativeDirPath: join(subprojectPath),
        relativeFilePath: AGENTSMD_RULE_FILE_NAME,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: false,
      });
    }

    // Every other non-root rule folds into the root file: the tool has no
    // modular non-root instruction directory to map topic rules onto.
    return new this({
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

    // The nested file *is* the AGENTS.md standard's own per-directory file, at
    // the same path several other targets read. Importing it through the
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
  }: ToolRuleForDeletionParams): NestedAgentsmdRule {
    const isRoot =
      relativeFilePath === AGENTSMD_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === this.getFamily().globalDir);

    return new this({
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
      toolTarget: this.getFamily().toolTarget,
    });
  }
}
