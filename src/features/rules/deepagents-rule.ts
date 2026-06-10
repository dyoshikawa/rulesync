import { join } from "node:path";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type DeepagentsRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * deepagents (dcode) loads project context only from the fixed
 * `.deepagents/AGENTS.md` (and root `AGENTS.md`) files via its MemoryMiddleware
 * — it never scans a `.deepagents/memories/` directory and does not follow
 * `@`-style references. Non-root rule content is therefore folded into the
 * single root `.deepagents/AGENTS.md` by the RulesProcessor, so there is no
 * separate non-root output location (`nonRoot` is `undefined`).
 *
 * @see https://github.com/langchain-ai/deepagents/blob/main/libs/code/deepagents_code/project_utils.py
 * @see https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/memory.py
 */
export type DeepagentsRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class DeepagentsRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: DeepagentsRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): DeepagentsRuleSettablePaths {
    // dcode reads user-level context from `~/.deepagents/<agent_name>/AGENTS.md`
    // (default agent_name `deepagents`); the home directory is resolved by the
    // processor through outputRoot in global mode. Project context lives in
    // `<project>/.deepagents/AGENTS.md`.
    return {
      root: {
        relativeDirPath: global ? join(".deepagents", "deepagents") : ".deepagents",
        relativeFilePath: "AGENTS.md",
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    // All deepagents rule content lives in the single `.deepagents/AGENTS.md`,
    // so the incoming `relativeFilePath` is ignored and the root file is read.
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<DeepagentsRule> {
    const settablePaths = this.getSettablePaths({ global });
    const relativePath = join(
      settablePaths.root.relativeDirPath,
      settablePaths.root.relativeFilePath,
    );
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new DeepagentsRule({
      outputRoot,
      relativeDirPath: settablePaths.root.relativeDirPath,
      relativeFilePath: settablePaths.root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): DeepagentsRule {
    // The deepagents root file is always `AGENTS.md`, under `.deepagents`
    // (project) or `.deepagents/deepagents` (global).
    const isRoot =
      relativeFilePath === "AGENTS.md" &&
      (relativeDirPath === ".deepagents" || relativeDirPath === join(".deepagents", "deepagents"));

    return new DeepagentsRule({
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
    global = false,
  }: ToolRuleFromRulesyncRuleParams): DeepagentsRule {
    const rootPath = this.getSettablePaths({ global }).root;
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    // deepagents reads context only from the fixed root AGENTS.md file
    // (`.deepagents/AGENTS.md` for project, `.deepagents/deepagents/AGENTS.md`
    // for global). Both root and non-root rules therefore target that single
    // path; the RulesProcessor folds the non-root bodies (`root: false`) into
    // the root rule and drops the redundant non-root instances before writing.
    return new DeepagentsRule({
      outputRoot,
      relativeDirPath: rootPath.relativeDirPath,
      relativeFilePath: rootPath.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: isRoot,
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
      toolTarget: "deepagents",
    });
  }
}
