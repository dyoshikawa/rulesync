import { join } from "node:path";

import { XUM_DIR, XUM_RULE_FILE_NAME } from "../../constants/xum-paths.js";
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

export type XumRuleParams = AiFileParams & {
  root?: boolean;
  localRoot?: boolean;
};

/**
 * Settable paths for Xum rules. Xum reads a single Xum-dedicated instruction
 * file per directory and has no rules directory, so there is no `nonRoot`
 * location: rulesync's topic-based non-root rules are folded into the root
 * file by the RulesProcessor.
 */
export type XumRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

/**
 * Rule generator for Xum (Coder's parallel coding-agent app, formerly Mux).
 *
 * Xum layers its own `.xum/AGENTS.md` (project) and `~/.xum/AGENTS.md` (user)
 * on top of the shared root `AGENTS.md` / `AGENT.md` / `CLAUDE.md`, which the
 * `agentsmd` target already writes, so this target writes only the
 * Xum-dedicated file. Only these files honor the `## Model: <regex>` and
 * `## Mode: <mode>` scoped sections; rulesync passes the body through as-is,
 * so such sections authored in a rule keep working. The personal
 * `.xum/AGENTS.local.md` overlay is written for a `localRoot: true` rule.
 *
 * @see https://xum.cdr.dev/agents/instruction-files
 */
export class XumRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: XumRuleParams) {
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
  ): XumRuleSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return {
      root: {
        relativeDirPath: XUM_DIR,
        relativeFilePath: XUM_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<XumRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new XumRule({
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
  }: ToolRuleFromRulesyncRuleParams): XumRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new XumRule({
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
  }: ToolRuleForDeletionParams): XumRule {
    const isRoot = relativeFilePath === XUM_RULE_FILE_NAME && relativeDirPath === XUM_DIR;

    return new XumRule({
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
      toolTarget: "xum",
    });
  }
}
