import { join } from "node:path";

import {
  OPENCLAW_RULE_FILE_NAME,
  OPENCLAW_WORKSPACE_DIR_PATH,
} from "../../constants/openclaw-paths.js";
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

export type OpenclawRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for OpenClaw, the always-on assistant gateway.
 *
 * OpenClaw injects the agent workspace's `AGENTS.md`
 * (`~/.openclaw/workspace/AGENTS.md` by default) into every session, and when
 * a session runs from another folder or a managed worktree it appends that
 * folder's `AGENTS.md` as project context. OpenClaw documents no
 * per-directory walk, so there is no nested rules surface to emit and rulesync's
 * topic-based non-root rules are folded into the single root file by the
 * RulesProcessor (`nonRoot` is `undefined`). The sibling persona files
 * (`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`) are left alone.
 *
 * @see https://docs.openclaw.ai/concepts/system-prompt
 * @see https://docs.openclaw.ai/concepts/agent-workspace
 */
export type OpenclawRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class OpenclawRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: OpenclawRuleParams) {
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
  } = {}): OpenclawRuleSettablePaths {
    return {
      root: {
        // The execution-folder file sits at the project root; the agent
        // workspace file sits under the home directory, which the processor
        // reaches by supplying the home directory as outputRoot.
        relativeDirPath: global ? OPENCLAW_WORKSPACE_DIR_PATH : ".",
        relativeFilePath: OPENCLAW_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<OpenclawRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new OpenclawRule({
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
  }: ToolRuleFromRulesyncRuleParams): OpenclawRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new OpenclawRule({
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
  }: ToolRuleForDeletionParams): OpenclawRule {
    const isRoot =
      relativeFilePath === OPENCLAW_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === OPENCLAW_WORKSPACE_DIR_PATH);

    return new OpenclawRule({
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
      toolTarget: "openclaw",
    });
  }
}
