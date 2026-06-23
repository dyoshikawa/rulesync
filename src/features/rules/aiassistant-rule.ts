import { join } from "node:path";

import { AIASSISTANT_RULES_DIR_PATH } from "../../constants/aiassistant-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type AiassistantRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for JetBrains AI Assistant.
 *
 * AI Assistant reads project rules as flat Markdown files in
 * `.aiassistant/rules/*.md` (one file per rule, identified by filename). The rule
 * type (Always / Manually / By model decision / By file patterns) is configured
 * in the IDE, not in the file, so the generated files are plain Markdown with no
 * frontmatter. There is no special root file (unlike Junie's `guidelines.md`), so
 * every rule — root or non-root — is written as its own file under `rules/`.
 *
 * AI Assistant and Junie are different JetBrains products (real-time assistance
 * vs. autonomous agent) with different layouts, so this is a separate target.
 *
 * @see https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html
 */
export class AiassistantRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): AiassistantRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: AIASSISTANT_RULES_DIR_PATH,
      },
    };
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AiassistantRule {
    // AI Assistant rules are plain Markdown without frontmatter; emit the rule
    // body as-is. Both root and non-root rules map to a flat file under rules/.
    return new AiassistantRule({
      outputRoot,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      fileContent: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AiassistantRule> {
    const relativeDirPath = this.getSettablePaths().nonRoot.relativeDirPath;
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new AiassistantRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: fileContent.trim(),
      validate,
      root: false,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): AiassistantRule {
    return new AiassistantRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: false,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "aiassistant",
    });
  }
}
