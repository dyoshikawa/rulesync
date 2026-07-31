import { join } from "node:path";

import { AGENTSMD_MEMORIES_DIR_PATH } from "../../constants/agentsmd-paths.js";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { RulesyncRule } from "./rulesync-rule.js";

export type ToolRuleParams = AiFileParams & {
  root?: boolean | undefined;
  /**
   * Marks a tool rule loaded from a tool's separate personal local-root file
   * (e.g. `CLAUDE.local.md`, `AGENTS.local.md`, `.qwen/QWEN.local.md`) so the
   * import flow maps it back to a canonical `localRoot: true` rulesync rule.
   */
  localRoot?: boolean | undefined;
  description?: string | undefined;
  globs?: string[] | undefined;
};

export type ToolRuleFromRulesyncRuleParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncRule: RulesyncRule;
  global?: boolean;
};

export type ToolRuleFromFileParams = AiFileFromFileParams;

export type ToolRuleForDeletionParams = {
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

/**
 * A fixed-path file a tool manages beyond its root/non-root rules (e.g. Pi's
 * `APPEND_SYSTEM.md`). Returned by the optional static `getExtraFixedFiles`
 * hook, consumed by the RulesProcessor (import/deletion) and the gitignore
 * derivation.
 */
export type ToolRuleExtraFixedFile = {
  relativeDirPath: string;
  relativeFilePath: string;
};

/**
 * Glob patterns for rule files a tool discovers by pattern rather than at a
 * fixed path (the AGENTS.md standard's nested subproject files). Returned by the
 * optional static `getNestedFilePatterns` hook and consumed by the
 * RulesProcessor on import.
 *
 * `ignore` is separate from `include` rather than expressed as `!` patterns
 * because globby rewrites a negative pattern containing no glob metacharacter as
 * cwd-relative, which makes an absolute one silently match nothing.
 */
export type ToolRuleNestedFilePatterns = {
  include: string[];
  ignore: string[];
};

export type ToolRuleSettablePaths = {
  root?: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  /** Fallback root paths tried when the primary root file is not found. Primary root always takes precedence. */
  alternativeRoots?: Array<{
    relativeDirPath: string;
    relativeFilePath: string;
  }>;
  nonRoot: {
    relativeDirPath: string;
  };
};

export type ToolRuleSettablePathsGlobal = {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  /** Fallback root paths tried when the primary root file is not found. Primary root always takes precedence. */
  alternativeRoots?: Array<{
    relativeDirPath: string;
    relativeFilePath: string;
  }>;
  /**
   * Optional non-root rules directory for global scope. Most tools have no
   * user-scoped modular-rules location and leave this unset, but tools that do
   * (e.g. Claude Code's `~/.claude/rules/`) set it so global non-root rules are
   * generated instead of being silently dropped.
   */
  nonRoot?: {
    relativeDirPath: string;
  };
};

type BuildToolRuleParamsParams = ToolRuleFromRulesyncRuleParams & {
  rootPath?: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRootPath?:
    | {
        relativeDirPath: string;
      }
    | undefined;
};

type BuildToolRuleParamsResult = Omit<ToolRuleParams, "root"> & {
  root: boolean;
};

export abstract class ToolRule extends ToolFile {
  protected readonly root: boolean;
  protected readonly localRoot: boolean;
  protected readonly description?: string | undefined;
  protected readonly globs?: string[] | undefined;

  constructor({ root = false, localRoot = false, description, globs, ...rest }: ToolRuleParams) {
    super(rest);
    this.root = root;
    this.localRoot = localRoot;
    this.description = description;
    this.globs = globs;
  }

  static getSettablePaths(
    _options: { global?: boolean; excludeToolDir?: boolean } = {},
  ): ToolRuleSettablePaths | ToolRuleSettablePathsGlobal {
    throw new Error("Please implement this method in the subclass.");
  }

  static async fromFile(_params: ToolRuleFromFileParams | undefined): Promise<ToolRule> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params: ToolRuleForDeletionParams): ToolRule {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncRule(_params: ToolRuleFromRulesyncRuleParams): ToolRule {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static buildToolRuleParamsDefault({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    rootPath = { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
    nonRootPath,
  }: BuildToolRuleParamsParams): BuildToolRuleParamsResult {
    const fileContent = rulesyncRule.getBody();
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    if (isRoot) {
      return {
        outputRoot,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        fileContent,
        validate,
        root: true,
        description: rulesyncRule.getFrontmatter().description,
        globs: rulesyncRule.getFrontmatter().globs,
      };
    }

    if (!nonRootPath) {
      throw new Error(`nonRoot path is not set for ${rulesyncRule.getRelativeFilePath()}`);
    }

    return {
      outputRoot,
      relativeDirPath: nonRootPath.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      fileContent,
      validate,
      root: false,
      description: rulesyncRule.getFrontmatter().description,
      globs: rulesyncRule.getFrontmatter().globs,
    };
  }

  protected static buildToolRuleParamsAgentsmd({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    rootPath = { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
    nonRootPath = { relativeDirPath: AGENTSMD_MEMORIES_DIR_PATH },
  }: BuildToolRuleParamsParams): BuildToolRuleParamsResult {
    const params = this.buildToolRuleParamsDefault({
      outputRoot,
      rulesyncRule,
      validate,
      rootPath,
      nonRootPath,
    });

    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    if (!rulesyncFrontmatter.root && rulesyncFrontmatter.agentsmd?.subprojectPath) {
      params.relativeDirPath = join(rulesyncFrontmatter.agentsmd.subprojectPath);
      params.relativeFilePath = "AGENTS.md";
    }

    return params;
  }

  abstract toRulesyncRule(): RulesyncRule;

  protected toRulesyncRuleDefault(): RulesyncRule {
    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.isRoot() ? RULESYNC_OVERVIEW_FILE_NAME : this.getRelativeFilePath(),
      frontmatter: {
        root: this.isRoot(),
        targets: ["*"],
        description: this.description,
        globs: this.globs ?? (this.isRoot() ? ["**/*"] : []),
      },
      body: this.getFileContent(),
    });
  }

  isRoot(): boolean {
    return this.root;
  }

  isLocalRoot(): boolean {
    return this.localRoot;
  }

  /**
   * Convert a tool's separate personal local-root file (see
   * {@link ToolRuleParams.localRoot}) back to a canonical `localRoot: true`
   * rulesync rule. The rulesync file keeps the tool-side basename
   * (`CLAUDE.local.md`, `AGENTS.local.md`, ...), which the derived `.gitignore`
   * already covers via `.rulesync/rules/*.local.md`, so personal content stays
   * untracked after import.
   */
  toLocalRootRulesyncRule(): RulesyncRule {
    return new RulesyncRule({
      outputRoot: this.getOutputRoot(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        localRoot: true,
        targets: ["*"],
        globs: [],
      },
      body: this.getFileContent(),
      validate: true,
    });
  }

  /**
   * Whether this rule must be left out of the root rule's reference/MCP
   * instruction listings even though it is a non-root survivor. Used by files
   * the tool loads through its own mechanism (e.g. Pi's `APPEND_SYSTEM.md`,
   * which Pi appends to the system prompt itself — referencing it from
   * `AGENTS.md` would double-load the content).
   */
  isExcludedFromRootReferences(): boolean {
    return false;
  }

  getDescription(): string | undefined {
    return this.description;
  }

  getGlobs(): string[] | undefined {
    return this.globs;
  }

  static isTargetedByRulesyncRule(_rulesyncRule: RulesyncRule): boolean {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static isTargetedByRulesyncRuleDefault({
    rulesyncRule,
    toolTarget,
  }: {
    rulesyncRule: RulesyncRule;
    toolTarget: ToolTarget;
  }): boolean {
    const targets = rulesyncRule.getFrontmatter().targets;
    if (!targets) {
      return true;
    }

    if (targets.includes("*")) {
      return true;
    }

    if (targets.includes(toolTarget)) {
      return true;
    }

    return false;
  }
}

export function buildToolPath(toolDir: string, subDir: string, excludeToolDir?: boolean): string {
  return excludeToolDir ? subDir : join(toolDir, subDir);
}
