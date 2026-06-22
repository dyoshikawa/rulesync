import { join } from "node:path";

import { CODEXCLI_DIR, CODEXCLI_RULE_FILE_NAME } from "../../constants/codexcli-paths.js";
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

export type CodexcliRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for OpenAI Codex CLI.
 *
 * Codex CLI loads project instructions only from the `AGENTS.md` family — the
 * global `~/.codex/AGENTS.md`, then hierarchical `AGENTS.md` / `AGENTS.override.md`
 * files discovered by walking from the project root to the current working
 * directory. It does NOT scan a `.codex/memories/` directory for instruction
 * files — that directory belongs to Codex's separate SQLite-backed auto-memory
 * system. (Verified against the official docs:
 * https://developers.openai.com/codex/guides/agents-md)
 *
 * rulesync's topic-based non-root rules have no project subdirectory to map
 * onto, so their bodies are folded into the single root `AGENTS.md` by the
 * RulesProcessor; there is no separate non-root output location (`nonRoot` is
 * `undefined`). This mirrors the grokcli, warp, and deepagents targets.
 */
export type CodexcliRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class CodexcliRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: CodexcliRuleParams) {
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
  } = {}): CodexcliRuleSettablePaths {
    return {
      root: {
        relativeDirPath: global ? CODEXCLI_DIR : ".",
        relativeFilePath: CODEXCLI_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<CodexcliRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new CodexcliRule({
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
  }: ToolRuleFromRulesyncRuleParams): CodexcliRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new CodexcliRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
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

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): CodexcliRule {
    const isRoot =
      relativeFilePath === CODEXCLI_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === CODEXCLI_DIR);

    return new CodexcliRule({
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
      toolTarget: "codexcli",
    });
  }
}
