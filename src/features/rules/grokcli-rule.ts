import { join } from "node:path";

import { GROKCLI_DIR, GROKCLI_RULE_FILE_NAME } from "../../constants/grokcli-paths.js";
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

export type GrokcliRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for xAI Grok Build CLI.
 *
 * Grok Build loads project instructions only from the AGENTS.md family — the
 * global `~/.grok/AGENTS.md`, then the git-root/CWD `AGENTS.md`, plus nested
 * per-directory `AGENTS.md`/`AGENTS.override.md` files. It does NOT scan a
 * `.grok/memories/` directory and does not follow `@`-style references out of a
 * rules file. (Verified against `grok` 0.2.54: with a git project containing
 * `AGENTS.md`, `.grok/memories/extra.md`, and `.grok/AGENTS.md`, `grok inspect`
 * lists only the root `AGENTS.md` under `projectInstructions`; the
 * `.grok/memories/*` and `.grok/AGENTS.md` files never appear. From a
 * subdirectory it additionally lists that directory's nested `AGENTS.md`.)
 *
 * rulesync's topic-based non-root rules have no project subdirectory to map
 * onto, so their bodies are folded into the single root `AGENTS.md` by the
 * RulesProcessor; there is no separate non-root output location (`nonRoot` is
 * `undefined`). This mirrors the warp and deepagents targets.
 *
 * @see https://docs.x.ai/build/overview
 */
export type GrokcliRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class GrokcliRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: GrokcliRuleParams) {
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
  } = {}): GrokcliRuleSettablePaths {
    // Project instructions live in the repository-root `AGENTS.md`; user-level
    // instructions live in `~/.grok/AGENTS.md` (the home directory is resolved
    // by the processor through outputRoot in global mode).
    return {
      root: {
        relativeDirPath: global ? GROKCLI_DIR : ".",
        relativeFilePath: GROKCLI_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    // Grok reads rules only from the root `AGENTS.md`, so the incoming
    // `relativeFilePath` is ignored and the root file is read.
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<GrokcliRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new GrokcliRule({
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
  }: ToolRuleFromRulesyncRuleParams): GrokcliRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    // Both root and non-root rules target the single root `AGENTS.md`; the
    // RulesProcessor folds the non-root bodies (`root: false`) into the root
    // rule and drops the redundant non-root instances before writing.
    return new GrokcliRule({
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
    // Grok Build rules are always valid since they don't have complex frontmatter.
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): GrokcliRule {
    // The Grok root file is always `AGENTS.md`, at the project root (`.`) or
    // under `.grok` (global `~/.grok/AGENTS.md`).
    const isRoot =
      relativeFilePath === GROKCLI_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === GROKCLI_DIR);

    return new GrokcliRule({
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
      toolTarget: "grokcli",
    });
  }
}
