import { join } from "node:path";

import { COMMANDCODE_DIR, COMMANDCODE_RULE_FILE_NAME } from "../../constants/commandcode-paths.js";
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

export type CommandcodeRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for Command Code, the open-source terminal coding agent.
 *
 * Command Code reads the project `AGENTS.md` at the repository root (the
 * `.commandcode/AGENTS.md` fallback is only consulted when the root file is
 * missing) and the user `~/.commandcode/AGENTS.md`. An `AGENTS.md` in a
 * subdirectory is loaded lazily, only once the agent touches a file beneath
 * it, so there is no deterministic nested rules surface to emit and rulesync's
 * topic-based non-root rules are folded into the single root file by the
 * RulesProcessor (`nonRoot` is `undefined`).
 *
 * @see https://commandcode.ai/docs/memory
 */
export type CommandcodeRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class CommandcodeRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: CommandcodeRuleParams) {
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
  } = {}): CommandcodeRuleSettablePaths {
    return {
      root: {
        // The workspace file sits at the project root; the user file sits
        // inside the profile directory, which the processor reaches by
        // supplying the home directory as outputRoot.
        relativeDirPath: global ? COMMANDCODE_DIR : ".",
        relativeFilePath: COMMANDCODE_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<CommandcodeRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new CommandcodeRule({
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
  }: ToolRuleFromRulesyncRuleParams): CommandcodeRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new CommandcodeRule({
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
  }: ToolRuleForDeletionParams): CommandcodeRule {
    const isRoot =
      relativeFilePath === COMMANDCODE_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === COMMANDCODE_DIR);

    return new CommandcodeRule({
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
      toolTarget: "commandcode",
    });
  }
}
