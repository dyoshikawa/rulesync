import { join } from "node:path";

import { HERMESAGENT_RULE_FILE_NAME } from "../../constants/hermesagent-paths.js";
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

export type HermesagentRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for Hermes Agent.
 *
 * Hermes Agent auto-injects the project-root context file into its system
 * prompt (root priority: `.hermes.md` → `HERMES.md` → `AGENTS.md` →
 * `CLAUDE.md` → `.cursorrules`). Since the progressive subdirectory hint
 * discovery feature (hermes-agent #5291), it also reads nested
 * `AGENTS.md`/`CLAUDE.md`/`.cursorrules` files as it navigates directories
 * (`.hermes.md` stays root-only). There is no documented user-level rules
 * file (the global `~/.hermes/SOUL.md` is an agent-identity slot, not user
 * instructions), so rules are project-scope only.
 * @see https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/context-files.md
 *
 * rulesync deliberately does NOT emit nested per-directory files for that
 * discovery: rulesync's non-root rules are topic-based (globs/description)
 * and carry no target-directory placement, so mapping them onto nested
 * `AGENTS.md` files would require inventing placement semantics no other
 * adapter has. Their bodies are instead folded into the single root
 * `.hermes.md` by the RulesProcessor; there is no separate non-root output
 * location (`nonRoot` is `undefined`). This mirrors the grokcli / warp /
 * deepagents targets (decision recorded in issue #2214).
 */
export type HermesagentRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class HermesagentRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: HermesagentRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths(): HermesagentRuleSettablePaths {
    // Project instructions live in the repository-root `.hermes.md`. Hermes has
    // no user-level rules file, so rules are project-scope only.
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: HERMESAGENT_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    // Hermes reads rules only from the root `.hermes.md`, so the incoming
    // `relativeFilePath` is ignored and the root file is read.
    relativeFilePath: _relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<HermesagentRule> {
    const { root } = this.getSettablePaths();
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new HermesagentRule({
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
  }: ToolRuleFromRulesyncRuleParams): HermesagentRule {
    const { root } = this.getSettablePaths();
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    // Both root and non-root rules target the single root `.hermes.md`; the
    // RulesProcessor folds the non-root bodies (`root: false`) into the root
    // rule and drops the redundant non-root instances before writing.
    return new HermesagentRule({
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
    // Hermes Agent rules are always valid since they don't have complex frontmatter.
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): HermesagentRule {
    // The Hermes root file is always `.hermes.md` at the project root (`.`).
    const isRoot = relativeFilePath === HERMESAGENT_RULE_FILE_NAME && relativeDirPath === ".";

    return new HermesagentRule({
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
      toolTarget: "hermesagent",
    });
  }
}
