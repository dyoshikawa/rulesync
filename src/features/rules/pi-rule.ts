import { join } from "node:path";

import { PI_DIR, PI_RULE_FILE_NAME } from "../../constants/pi-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type PiRuleParams = AiFileParams & {
  root?: boolean;
};

export type PiRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

/**
 * Rule generator for Pi Coding Agent.
 *
 * Pi loads instruction context from the `AGENTS.md` / `CLAUDE.md` family —
 * the global `~/.pi/agent/AGENTS.md` plus files discovered by walking up the
 * directory tree from the current working directory. It does NOT resolve
 * `@`-imports or a TOON file list, and has no `.agents/memories/` concept, so
 * non-root rule bodies written to a subdirectory are never read.
 * (Verified against the official docs: https://pi.dev/docs/latest/usage)
 *
 * rulesync's topic-based non-root rules therefore have no project subdirectory
 * to map onto; their bodies are folded into the single root `AGENTS.md` by the
 * RulesProcessor (there is no separate non-root output location — `nonRoot` is
 * `undefined`). This mirrors the codexcli, grokcli, warp, and deepagents targets.
 *
 * Pi also loads two system-prompt instruction files that rulesync does NOT emit:
 * `.pi/SYSTEM.md` (global `~/.pi/agent/SYSTEM.md`) *replaces* the default system
 * prompt entirely, and `.pi/APPEND_SYSTEM.md` (global
 * `~/.pi/agent/APPEND_SYSTEM.md`) *appends* to it. rulesync's rules model only
 * routes a designated `root` rule to a single context file and has no convention
 * for marking a rule as "replace" vs "append" the system prompt, so these
 * surfaces are documented in docs/reference/file-formats.md and left to be
 * authored by hand rather than mapped to a speculative new frontmatter flag.
 */
export class PiRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: PiRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): PiRuleSettablePaths {
    return {
      root: {
        relativeDirPath: global ? buildToolPath(PI_DIR, "agent", excludeToolDir) : ".",
        relativeFilePath: PI_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<PiRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new PiRule({
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
  }: ToolRuleFromRulesyncRuleParams): PiRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new PiRule({
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
    // Pi rules are plain markdown files without complex frontmatter,
    // so any body content is considered valid.
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): PiRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === PI_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === root.relativeDirPath);

    return new PiRule({
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
      toolTarget: "pi",
    });
  }
}
