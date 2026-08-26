import { join } from "node:path";

import {
  AGENTSMD_DIR,
  AGENTSMD_MEMORIES_DIR_PATH,
  AGENTSMD_RULE_FILE_NAME,
} from "../../constants/agentsmd-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
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

export type AgentsMdRuleParams = AiFileParams & {
  root?: boolean;
};

export type AgentsMdRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export class AgentsMdRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: AgentsMdRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): AgentsMdRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: AGENTSMD_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(AGENTSMD_DIR, "memories", _options.excludeToolDir),
      },
    };
  }

  /**
   * Patterns for the nested `AGENTS.md` files that are the standard's only scoping
   * mechanism — "Agents automatically read the nearest file in the directory
   * tree, so the closest one takes precedence and every subproject can ship
   * tailored instructions." The project root file is excluded because it is
   * enumerated separately as the root rule.
   *
   * Import-only. The matches are hand-authored files anywhere in the tree rather
   * than files under a rulesync-owned directory, so enumerating them for
   * `--delete` would sweep away work rulesync never wrote.
   *
   * @see https://agents.md/
   */
  static getNestedFilePatterns({ outputRoot }: { outputRoot: string }): ToolRuleNestedFilePatterns {
    return this.buildNestedFilePatterns({ outputRoot, fileName: AGENTSMD_RULE_FILE_NAME });
  }

  /**
   * The subproject directory this rule scopes, or `undefined` for the project
   * root file and for the modular `.agents/memories/` files.
   */
  getSubprojectPath(): string | undefined {
    return this.getNestedSubprojectPath({ fileName: AGENTSMD_RULE_FILE_NAME });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AgentsMdRule> {
    // A nested subproject file is an `AGENTS.md` somewhere other than the project
    // root and outside the tool's own `.agents/` tree.
    const normalizedDirPath = relativeDirPath === undefined ? "." : toPosixPath(relativeDirPath);
    const isNested =
      relativeFilePath === AGENTSMD_RULE_FILE_NAME &&
      normalizedDirPath !== "." &&
      normalizedDirPath !== "" &&
      !normalizedDirPath.startsWith(".");
    // Only the file at the project root is the root rule. A modular file that
    // happens to be named `AGENTS.md` under `.agents/memories/` is not.
    const isRoot =
      !isNested &&
      relativeFilePath === AGENTSMD_RULE_FILE_NAME &&
      (normalizedDirPath === "." || normalizedDirPath === "");
    const relativePath = isNested
      ? join(normalizedDirPath, relativeFilePath)
      : isRoot
        ? AGENTSMD_RULE_FILE_NAME
        : join(AGENTSMD_MEMORIES_DIR_PATH, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new AgentsMdRule({
      outputRoot,
      // `join` so the stored path uses native separators like every other
      // construction path (`fromRulesyncRule` builds it the same way).
      relativeDirPath: isNested
        ? join(normalizedDirPath)
        : isRoot
          ? this.getSettablePaths().root.relativeDirPath
          : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? AGENTSMD_RULE_FILE_NAME : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): AgentsMdRule {
    const isRoot = relativeFilePath === AGENTSMD_RULE_FILE_NAME && relativeDirPath === ".";

    return new AgentsMdRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AgentsMdRule {
    return new AgentsMdRule(
      this.buildToolRuleParamsAgentsmd({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    const subprojectPath = this.getSubprojectPath();
    if (subprojectPath === undefined) {
      return this.toRulesyncRuleDefault();
    }

    return this.toRulesyncRuleNestedAgentsmd({ subprojectPath });
  }

  validate(): ValidationResult {
    // AGENTS.md rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "agentsmd",
    });
  }
}
