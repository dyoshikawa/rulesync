import { join } from "node:path";

import {
  GROKCLI_DIR,
  GROKCLI_GLOBAL_RULES_DIR_NAME,
  GROKCLI_RULE_FILE_NAME,
  GROKCLI_RULES_DIR_PATH,
} from "../../constants/grokcli-paths.js";
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
 * Grok Build reads the AGENTS.md family — the global `~/.grok/AGENTS.md`, then
 * the git-root/CWD `AGENTS.md`, plus nested per-directory `AGENTS.md` /
 * `AGENTS.override.md` files — and, alongside it, a flat `*.md` scan of a rules
 * directory: `.grok/rules/` in each project directory it walks up to the git
 * root, and `~/.grok/rules/` in the home scope. Files there are sorted by name.
 * It does NOT scan `.grok/memories/`, and does not follow `@`-style references
 * out of a rules file.
 *
 * The rules directory is why non-root rules have a home of their own here.
 * Earlier Rulesync folded every topic rule into the single root `AGENTS.md`,
 * which was right for grok 0.2.54 but not for 0.2.112.
 *
 * @see https://docs.x.ai/build/overview
 */
export type GrokcliRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
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
      // Project: `.grok/rules/`. Global: `rules/` directly under the home root,
      // which the processor resolves relative to `~/.grok`.
      nonRoot: {
        relativeDirPath: global
          ? join(GROKCLI_DIR, GROKCLI_GLOBAL_RULES_DIR_NAME)
          : GROKCLI_RULES_DIR_PATH,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<GrokcliRule> {
    const { root, nonRoot } = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === root.relativeFilePath;
    const relativeDirPath = isRoot ? root.relativeDirPath : nonRoot.relativeDirPath;
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new GrokcliRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): GrokcliRule {
    const { root, nonRoot } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new GrokcliRule({
      outputRoot,
      relativeDirPath: isRoot ? root.relativeDirPath : nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? root.relativeFilePath : rulesyncRule.getRelativeFilePath(),
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
